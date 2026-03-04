import type {
  DocumentProperties,
  DocumentPropertyOptionSnapshot,
  DocumentPropertySnapshot,
  JSONValue,
} from "@shared/types";
import { Op } from "sequelize";
import type { Transaction } from "sequelize";
import { DocumentPropertyType } from "@shared/types";
import { ValidationError } from "@server/errors";
import type { APIContext } from "@server/types";
import { sequelize } from "@server/storage/database";
import {
  extractDocumentPropertyValue,
  toDocumentPropertyValues,
  type DocumentPropertyLike,
} from "@server/utils/documentProperties";
import type { Document, PropertyDefinitionOption } from "@server/models";
import { DocumentProperty, PropertyDefinition } from "@server/models";

export interface DocumentPropertyInput {
  [propertyDefinitionId: string]: JSONValue | null | undefined;
}

export interface DocumentPropertyUpdatePlan {
  properties: DocumentProperties;
  upserts: {
    propertyDefinitionId: string;
    value: JSONValue;
  }[];
  deletes: string[];
}

export interface ApplyDocumentPropertyUpdateOptions {
  /**
   * When true, remove any normalized rows that are not present in the resulting
   * snapshot. Useful for full replacements (for example, revision restore).
   */
  replace?: boolean;
}
/**
 * Validates and prepares document property updates.
 *
 * @param ctx The request context.
 * @param document The document to apply properties to.
 * @param inputProperties The incoming property values keyed by property definition ID.
 * @param options Optional configuration for validation behavior.
 * @returns A mutation plan with merged properties and normalized row changes.
 */
export async function prepareDocumentPropertyUpdate(
  ctx: APIContext,
  document: Document,
  inputProperties: DocumentPropertyInput,
  options?: {
    collectionId?: string | null;
    strict?: boolean;
  }
): Promise<DocumentPropertyUpdatePlan> {
  const definitionIds = Object.keys(inputProperties);
  const mergedProperties: DocumentProperties = {
    ...(document.properties ?? {}),
  };

  const collectionId = options?.collectionId ?? document.collectionId;

  if (!collectionId) {
    if (definitionIds.length === 0) {
      return {
        properties: mergedProperties,
        upserts: [],
        deletes: [],
      };
    }

    throw ValidationError(
      "collectionId is required to update collection-scoped document properties"
    );
  }

  const uniqueDefinitionIds = Array.from(new Set(definitionIds));
  const definitions =
    uniqueDefinitionIds.length > 0
      ? await PropertyDefinition.findAll({
          where: {
            id: uniqueDefinitionIds,
            collectionId,
            teamId: document.teamId,
          },
          include: [
            {
              association: "options",
              required: false,
            },
          ],
          transaction: ctx.state.transaction,
        })
      : [];
  const definitionById = new Map(definitions.map((d) => [d.id, d]));
  const strict = options?.strict !== false;

  if (strict && definitions.length !== uniqueDefinitionIds.length) {
    throw ValidationError("One or more document properties are invalid");
  }

  const upserts: DocumentPropertyUpdatePlan["upserts"] = [];
  const deletes: string[] = [];

  for (const propertyDefinitionId of uniqueDefinitionIds) {
    const definition = definitionById.get(propertyDefinitionId);
    const inputValue = inputProperties[propertyDefinitionId];

    if (inputValue === undefined) {
      continue;
    }

    if (!definition) {
      if (strict) {
        throw ValidationError(
          `Property definition not found: ${propertyDefinitionId}`
        );
      }

      delete mergedProperties[propertyDefinitionId];
      addUnique(deletes, propertyDefinitionId);
      continue;
    }

    const normalized = normalizePropertyValue(definition, inputValue);

    if (normalized === null) {
      delete mergedProperties[propertyDefinitionId];
      addUnique(deletes, propertyDefinitionId);
      continue;
    }

    mergedProperties[propertyDefinitionId] = createPropertySnapshot(
      definition,
      normalized
    );
    upserts.push({
      propertyDefinitionId,
      value: normalized,
    });
  }

  const requiredDefinitions = await PropertyDefinition.findAll({
    where: {
      collectionId,
      teamId: document.teamId,
      required: true,
    },
    include: [
      {
        association: "options",
        required: false,
      },
    ],
    transaction: ctx.state.transaction,
  });

  for (const definition of requiredDefinitions) {
    const currentSnapshot = mergedProperties[
      definition.id
    ] as DocumentPropertyLike;
    const currentValue = sanitizeStoredPropertyValue(
      definition,
      extractDocumentPropertyValue(currentSnapshot)
    );

    if (currentValue === null) {
      addUnique(deletes, definition.id);
    }

    mergedProperties[definition.id] = createPropertySnapshot(
      definition,
      currentValue
    );
  }

  return {
    properties: mergedProperties,
    upserts,
    deletes,
  };
}

/**
 * Converts a denormalized document property snapshot to API/command input
 * format where values are keyed by property definition ID.
 *
 * @param properties The denormalized document property snapshot.
 * @returns Normalized input map keyed by property definition ID.
 */
export function toDocumentPropertyInput(
  properties: Record<string, DocumentPropertyLike>
): DocumentPropertyInput {
  return toDocumentPropertyValues(properties);
}

/**
 * Applies a prepared document property update plan to the normalized
 * `document_properties` table.
 *
 * @param ctx The request context.
 * @param document The document to mutate.
 * @param plan The prepared update plan.
 */
export async function applyDocumentPropertyUpdate(
  ctx: APIContext,
  document: Document,
  plan: DocumentPropertyUpdatePlan,
  options?: ApplyDocumentPropertyUpdateOptions
) {
  const { transaction } = ctx.state;
  const { user } = ctx.state.auth;

  if (plan.upserts.length > 0) {
    await DocumentProperty.bulkCreate(
      plan.upserts.map((upsert) => ({
        documentId: document.id,
        propertyDefinitionId: upsert.propertyDefinitionId,
        value: upsert.value,
        teamId: document.teamId,
        createdById: user.id,
        lastModifiedById: user.id,
      })),
      {
        updateOnDuplicate: ["value", "lastModifiedById", "updatedAt"],
        conflictAttributes: ["documentId", "propertyDefinitionId"],
        transaction,
      }
    );
  }

  if (plan.deletes.length > 0) {
    await DocumentProperty.destroy({
      where: {
        documentId: document.id,
        propertyDefinitionId: plan.deletes,
      },
      transaction,
    });
  }

  if (options?.replace) {
    const keepDefinitionIds = plan.upserts.map(
      (upsert) => upsert.propertyDefinitionId
    );

    if (keepDefinitionIds.length === 0) {
      await DocumentProperty.destroy({
        where: {
          documentId: document.id,
        },
        transaction,
      });
    } else {
      await DocumentProperty.destroy({
        where: {
          documentId: document.id,
          propertyDefinitionId: {
            [Op.notIn]: keepDefinitionIds,
          },
        },
        transaction,
      });
    }
  }
}

/**
 * Clears all document properties (both the denormalized JSONB snapshot and
 * normalized rows) for the given document IDs within a transaction.
 *
 * @param documentIds - the IDs of the documents to clear.
 * @param transaction - the active Sequelize transaction.
 */
export async function clearDocumentProperties(
  documentIds: string[],
  transaction: Transaction
) {
  if (documentIds.length === 0) {
    return;
  }

  await Promise.all([
    sequelize.query(
      `UPDATE documents SET properties = '{}' WHERE id IN (:documentIds)`,
      { replacements: { documentIds }, transaction }
    ),
    DocumentProperty.destroy({
      where: { documentId: documentIds },
      transaction,
    }),
  ]);
}

/**
 * Synchronizes all document property snapshots and normalized rows for a
 * property definition after metadata changes (for example renaming a property
 * or modifying selectable options).
 *
 * @param ctx The request context.
 * @param definition The updated property definition.
 */
export async function syncDocumentPropertiesForDefinition(
  ctx: APIContext,
  definition: PropertyDefinition
) {
  const { transaction } = ctx.state;
  const { user } = ctx.state.auth;

  const rows = await DocumentProperty.findAll({
    where: {
      propertyDefinitionId: definition.id,
      teamId: definition.teamId,
    },
    transaction,
  });

  const rowsToDelete: string[] = [];
  const rowsToUpsert: Array<{
    id: string;
    documentId: string;
    propertyDefinitionId: string;
    value: JSONValue;
    teamId: string;
    createdById: string;
    lastModifiedById: string;
  }> = [];
  const snapshotsByDocumentId = new Map<string, DocumentPropertySnapshot>();

  for (const row of rows) {
    const normalized = sanitizeStoredPropertyValue(definition, row.value);

    if (normalized === null) {
      rowsToDelete.push(row.id);
      continue;
    }

    if (!isSameJSONValue(row.value, normalized)) {
      rowsToUpsert.push({
        id: row.id,
        documentId: row.documentId,
        propertyDefinitionId: row.propertyDefinitionId,
        value: normalized,
        teamId: row.teamId,
        createdById: row.createdById,
        lastModifiedById: user.id,
      });
    }

    snapshotsByDocumentId.set(
      row.documentId,
      createPropertySnapshot(definition, normalized)
    );
  }

  if (rowsToDelete.length > 0) {
    await DocumentProperty.destroy({
      where: {
        id: rowsToDelete,
      },
      transaction,
    });
  }

  if (rowsToUpsert.length > 0) {
    await DocumentProperty.bulkCreate(rowsToUpsert, {
      updateOnDuplicate: ["value", "lastModifiedById", "updatedAt"],
      transaction,
    });
  }

  await sequelize.query(
    `UPDATE documents
     SET properties = COALESCE(properties, '{}'::jsonb) - :propertyDefinitionId
     WHERE "collectionId" = :collectionId
       AND COALESCE(properties, '{}'::jsonb) ? :propertyDefinitionId`,
    {
      replacements: {
        collectionId: definition.collectionId,
        propertyDefinitionId: definition.id,
      },
      transaction,
    }
  );

  await applyPropertySnapshotsToDocuments({
    collectionId: definition.collectionId,
    propertyDefinitionId: definition.id,
    snapshots: Array.from(snapshotsByDocumentId.entries()),
    transaction,
  });
}

async function applyPropertySnapshotsToDocuments({
  collectionId,
  propertyDefinitionId,
  snapshots,
  transaction,
}: {
  collectionId: string;
  propertyDefinitionId: string;
  snapshots: [string, DocumentPropertySnapshot][];
  transaction: Transaction;
}) {
  if (snapshots.length === 0) {
    return;
  }

  const chunkSize = 200;

  for (let i = 0; i < snapshots.length; i += chunkSize) {
    const chunk = snapshots.slice(i, i + chunkSize);
    const replacements: Record<string, string> = {
      collectionId,
      propertyDefinitionId,
    };
    const values = chunk
      .map(([documentId, snapshot], index) => {
        const documentKey = `documentId${index}`;
        const snapshotKey = `snapshot${index}`;

        replacements[documentKey] = documentId;
        replacements[snapshotKey] = JSON.stringify(snapshot);

        return `(CAST(:${documentKey} AS uuid), CAST(:${snapshotKey} AS jsonb))`;
      })
      .join(", ");

    await sequelize.query(
      `UPDATE documents AS d
       SET properties = jsonb_set(
         COALESCE(d.properties, '{}'::jsonb),
         ARRAY[:propertyDefinitionId]::text[],
         source.snapshot,
         true
       )
       FROM (VALUES ${values}) AS source(document_id, snapshot)
       WHERE d.id = source.document_id
         AND d."collectionId" = :collectionId`,
      {
        replacements,
        transaction,
      }
    );
  }
}

function sanitizeStoredPropertyValue(
  definition: PropertyDefinition,
  value: JSONValue | null
): JSONValue | null {
  if (value === null || value === undefined) {
    return null;
  }

  const optionsById = new Set(
    (definition.options ?? []).map((option) => option.id)
  );

  switch (definition.type) {
    case DocumentPropertyType.Text: {
      return typeof value === "string" && value.length > 0 ? value : null;
    }

    case DocumentPropertyType.Number: {
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    }

    case DocumentPropertyType.Date: {
      return typeof value === "string" && !Number.isNaN(Date.parse(value))
        ? value
        : null;
    }

    case DocumentPropertyType.Select: {
      if (typeof value !== "string" || value.length === 0) {
        return null;
      }

      return optionsById.has(value) ? value : null;
    }

    case DocumentPropertyType.MultiSelect: {
      if (!isStringArray(value)) {
        return null;
      }

      const uniqueValidOptionIds = Array.from(
        new Set(value.filter((optionId) => optionsById.has(optionId)))
      );

      return uniqueValidOptionIds.length > 0 ? uniqueValidOptionIds : null;
    }

    default:
      return null;
  }
}

function isSameJSONValue(left: JSONValue | null, right: JSONValue | null) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizePropertyValue(
  definition: PropertyDefinition,
  value: JSONValue | null
): JSONValue | null {
  if (value === null) {
    return null;
  }

  const optionsById = new Map(
    (definition.options ?? []).map((option) => [option.id, option])
  );

  switch (definition.type) {
    case DocumentPropertyType.Text: {
      if (typeof value !== "string") {
        throw ValidationError(`Expected text value for "${definition.name}"`);
      }

      return value.length > 0 ? value : null;
    }

    case DocumentPropertyType.Number: {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw ValidationError(
          `Expected numeric value for "${definition.name}"`
        );
      }

      return value;
    }

    case DocumentPropertyType.Date: {
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        throw ValidationError(`Expected date value for "${definition.name}"`);
      }

      return value;
    }

    case DocumentPropertyType.Select: {
      if (typeof value !== "string") {
        throw ValidationError(`Expected option ID for "${definition.name}"`);
      }

      if (value.length === 0) {
        return null;
      }

      if (!optionsById.has(value)) {
        throw ValidationError(`Invalid option ID for "${definition.name}"`);
      }

      return value;
    }

    case DocumentPropertyType.MultiSelect: {
      if (!isStringArray(value)) {
        throw ValidationError(
          `Expected option ID array for "${definition.name}"`
        );
      }

      if (value.length === 0) {
        return null;
      }

      for (const optionId of value) {
        if (!optionsById.has(optionId)) {
          throw ValidationError(`Invalid option ID for "${definition.name}"`);
        }
      }

      return Array.from(new Set(value));
    }

    default:
      throw ValidationError(`Unsupported property type "${definition.type}"`);
  }
}

function addUnique(items: string[], value: string) {
  if (!items.includes(value)) {
    items.push(value);
  }
}

function isStringArray(value: JSONValue): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function createPropertySnapshot(
  definition: PropertyDefinition,
  value: JSONValue
): DocumentPropertySnapshot {
  const snapshot: DocumentPropertySnapshot = {
    definitionId: definition.id,
    name: definition.name,
    type: definition.type,
    value,
  };

  if (
    definition.type === DocumentPropertyType.Select &&
    typeof value === "string"
  ) {
    const selected = definition.options?.find((option) => option.id === value);

    if (selected) {
      snapshot.options = [toOptionSnapshot(selected)];
    }
  }

  if (
    definition.type === DocumentPropertyType.MultiSelect &&
    isStringArray(value)
  ) {
    const selected = value
      .map((optionId) =>
        definition.options?.find((option) => option.id === optionId)
      )
      .filter((option): option is PropertyDefinitionOption => !!option)
      .map(toOptionSnapshot);

    if (selected.length > 0) {
      snapshot.options = selected;
    }
  }

  return snapshot;
}

function toOptionSnapshot(
  option: PropertyDefinitionOption
): DocumentPropertyOptionSnapshot {
  return {
    id: option.id,
    value: option.value,
    color: option.color,
  };
}
