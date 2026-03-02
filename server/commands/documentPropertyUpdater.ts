import type {
  DocumentProperties,
  DocumentPropertyOptionSnapshot,
  DocumentPropertySnapshot,
  JSONValue,
} from "@shared/types";
import { Op } from "sequelize";
import { DocumentPropertyType } from "@shared/types";
import { ValidationError } from "@server/errors";
import type { APIContext } from "@server/types";
import { sequelize } from "@server/storage/database";
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

  if (definitionIds.length === 0) {
    return {
      properties: mergedProperties,
      upserts: [],
      deletes: [],
    };
  }

  const collectionId = options?.collectionId ?? document.collectionId;

  if (!collectionId) {
    throw ValidationError(
      "collectionId is required to update collection-scoped document properties"
    );
  }

  const uniqueDefinitionIds = Array.from(new Set(definitionIds));
  const definitions = await PropertyDefinition.findAll({
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
  });
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
      deletes.push(propertyDefinitionId);
      continue;
    }

    const normalized = normalizePropertyValue(definition, inputValue);

    if (normalized === null) {
      delete mergedProperties[propertyDefinitionId];
      deletes.push(propertyDefinitionId);
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
  properties: DocumentProperties
): DocumentPropertyInput {
  return Object.fromEntries(
    Object.entries(properties).map(([propertyDefinitionId, property]) => [
      propertyDefinitionId,
      property.value,
    ])
  );
}

/**
 * Validates that all required property definitions for a collection have
 * non-empty values on the document snapshot.
 *
 * @param ctx The request context.
 * @param document The document being validated.
 * @param options Optional collection override.
 */
export async function validateRequiredDocumentProperties(
  ctx: APIContext,
  document: Document,
  options?: {
    collectionId?: string | null;
  }
) {
  const collectionId = options?.collectionId ?? document.collectionId;

  if (!collectionId) {
    return;
  }

  const definitions = await PropertyDefinition.findAll({
    attributes: ["id", "name"],
    where: {
      collectionId,
      teamId: document.teamId,
      required: true,
    },
    transaction: ctx.state.transaction,
  });

  for (const definition of definitions) {
    const snapshot = document.properties?.[definition.id];

    if (!snapshot || isEmptyValue(snapshot.value)) {
      throw ValidationError(`Property "${definition.name}" is required`);
    }
  }
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

  for (const upsert of plan.upserts) {
    const existing = await DocumentProperty.findOne({
      where: {
        documentId: document.id,
        propertyDefinitionId: upsert.propertyDefinitionId,
      },
      transaction,
    });

    if (existing) {
      existing.value = upsert.value;
      existing.lastModifiedById = user.id;
      await existing.save({ transaction });
      continue;
    }

    await DocumentProperty.create(
      {
        documentId: document.id,
        propertyDefinitionId: upsert.propertyDefinitionId,
        value: upsert.value,
        teamId: document.teamId,
        createdById: user.id,
        lastModifiedById: user.id,
      },
      {
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

  const snapshotsByDocumentId = new Map<string, DocumentPropertySnapshot>();

  for (const row of rows) {
    const normalized = sanitizeStoredPropertyValue(definition, row.value);

    if (normalized === null) {
      await row.destroy({ transaction });
      continue;
    }

    if (!isSameJSONValue(row.value, normalized)) {
      row.value = normalized;
      row.lastModifiedById = user.id;
      await row.save({ transaction });
    }

    snapshotsByDocumentId.set(
      row.documentId,
      createPropertySnapshot(definition, normalized)
    );
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

  for (const [documentId, snapshot] of snapshotsByDocumentId) {
    await sequelize.query(
      `UPDATE documents
       SET properties = jsonb_set(
         COALESCE(properties, '{}'::jsonb),
         ARRAY[:propertyDefinitionId]::text[],
         CAST(:snapshot AS jsonb),
         true
       )
       WHERE id = :documentId
         AND "collectionId" = :collectionId`,
      {
        replacements: {
          collectionId: definition.collectionId,
          documentId,
          propertyDefinitionId: definition.id,
          snapshot: JSON.stringify(snapshot),
        },
        transaction,
      }
    );
  }
}

function isEmptyValue(value: JSONValue | null | undefined): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "string") {
    return value.length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return false;
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
