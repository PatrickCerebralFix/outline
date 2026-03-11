import type { DocumentProperties, DocumentPropertyValues, JSONValue } from "@shared/types";
import { DocumentPropertyType } from "@shared/types";
import { Op } from "sequelize";
import type { Transaction } from "sequelize";
import { ValidationError } from "@server/errors";
import {
  Document,
  DocumentProperty,
  PropertyDefinition,
  User,
} from "@server/models";
import type { Document as DocumentModel } from "@server/models";
import { sequelize } from "@server/storage/database";
import type { APIContext } from "@server/types";
import { resolveCollectionPropertyDefinitions } from "@server/utils/collectionPropertyDefinitions";
import {
  toDocumentPropertyValues,
} from "@server/utils/documentProperties";

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

export interface ReconcileDocumentPropertyOptionsInput {
  propertyDefinitionId: string;
  userId: string;
  batchSize?: number;
}

export interface ReconcileDocumentPropertyOptionsResult {
  processedDocuments: number;
  updatedDocuments: number;
  deletedRows: number;
  upsertedRows: number;
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
  document: DocumentModel,
  inputProperties: DocumentPropertyInput,
  options?: {
    collectionId?: string | null;
    strict?: boolean;
  }
): Promise<DocumentPropertyUpdatePlan> {
  const definitionIds = Object.keys(inputProperties);
  const mergedProperties: DocumentProperties = {
    ...toDocumentPropertyValues(document.properties ?? {}),
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
  const resolvedDefinitions = await resolveCollectionPropertyDefinitions(
    collectionId,
    document.teamId,
    ctx.state.transaction
  );
  const definitionById = new Map(
    resolvedDefinitions.effective.map((row) => [row.definition.id, row])
  );
  const strict = options?.strict !== false;

  if (
    strict &&
    uniqueDefinitionIds.some((propertyDefinitionId) => !definitionById.has(propertyDefinitionId))
  ) {
    throw ValidationError("One or more document properties are invalid");
  }

  const upserts: DocumentPropertyUpdatePlan["upserts"] = [];
  const deletes: string[] = [];
  const userDefinitionIds = new Set(
    resolvedDefinitions.effective
      .filter((row) => row.definition.type === DocumentPropertyType.User)
      .map((row) => row.definition.id)
  );
  const referencedUserIds = Array.from(
    new Set(
      resolvedDefinitions.effective
        .filter((row) => userDefinitionIds.has(row.definition.id))
        .flatMap((row) => {
          const inputValue = inputProperties[row.definition.id];
          if (Array.isArray(inputValue)) {
            return inputValue.filter(
              (entry): entry is string => typeof entry === "string"
            );
          }

          const storedValue = mergedProperties[row.definition.id];
          return Array.isArray(storedValue)
            ? storedValue.filter(
                (entry): entry is string => typeof entry === "string"
              )
            : [];
        })
    )
  );
  const validUserIds = userDefinitionIds.size
    ? await resolveTeamUserIds(document.teamId, referencedUserIds, ctx.state.transaction)
    : new Set<string>();

  for (const propertyDefinitionId of uniqueDefinitionIds) {
    const resolvedDefinition = definitionById.get(propertyDefinitionId);
    const inputValue = inputProperties[propertyDefinitionId];

    if (inputValue === undefined) {
      continue;
    }

    if (!resolvedDefinition) {
      if (strict) {
        throw ValidationError(
          `Property definition not found: ${propertyDefinitionId}`
        );
      }

      delete mergedProperties[propertyDefinitionId];
      addUnique(deletes, propertyDefinitionId);
      continue;
    }

    const normalized = normalizePropertyValue(
      resolvedDefinition.definition,
      inputValue,
      validUserIds
    );

    if (normalized === null) {
      delete mergedProperties[propertyDefinitionId];
      addUnique(deletes, propertyDefinitionId);
      continue;
    }

    mergedProperties[propertyDefinitionId] = normalized;
    replaceUpsert(upserts, {
      propertyDefinitionId,
      value: normalized,
    });
  }

  for (const resolvedDefinition of resolvedDefinitions.effective.filter(
    (row) => row.required
  )) {
    const definition = resolvedDefinition.definition;
    const currentValue = sanitizeStoredPropertyValue(
      definition,
      mergedProperties[definition.id],
      validUserIds
    );
    const hydratedValue = hydrateRequiredPropertyValue(
      definition,
      currentValue
    );

    mergedProperties[definition.id] = hydratedValue;
    removeValue(deletes, definition.id);
    replaceUpsert(upserts, {
      propertyDefinitionId: definition.id,
      value: hydratedValue,
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
  properties: DocumentPropertyValues
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
  document: DocumentModel,
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
 * @param documentIds The IDs of the documents to clear.
 * @param transaction The active Sequelize transaction.
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
 * Reconciles stored document property values for a selectable definition after
 * its option set changes.
 *
 * @param input Task input describing which definition to reconcile.
 * @returns Counters describing the work performed.
 */
export async function reconcileDocumentPropertyOptions(
  input: ReconcileDocumentPropertyOptionsInput
): Promise<ReconcileDocumentPropertyOptionsResult> {
  const { propertyDefinitionId, userId, batchSize = 100 } = input;
  const definition = await PropertyDefinition.findOne({
    where: {
      id: propertyDefinitionId,
    },
    include: [
      {
        association: "options",
        required: false,
      },
    ],
  });

  if (
    !definition ||
    (definition.type !== DocumentPropertyType.Select &&
      definition.type !== DocumentPropertyType.MultiSelect)
  ) {
    return {
      processedDocuments: 0,
      updatedDocuments: 0,
      deletedRows: 0,
      upsertedRows: 0,
    };
  }

  const result: ReconcileDocumentPropertyOptionsResult = {
    processedDocuments: 0,
    updatedDocuments: 0,
    deletedRows: 0,
    upsertedRows: 0,
  };
  let lastRowId: string | undefined;

  for (;;) {
    const chunk = await sequelize.transaction(async (transaction) => {
      const rows = await DocumentProperty.findAll({
        where: {
          propertyDefinitionId: definition.id,
          teamId: definition.teamId,
          ...(lastRowId
            ? {
                id: {
                  [Op.gt]: lastRowId,
                },
              }
            : {}),
        },
        order: [["id", "ASC"]],
        limit: batchSize,
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (rows.length === 0) {
        return null;
      }

      const documentIds = Array.from(
        new Set(rows.map((row) => row.documentId))
      );
      const documents = await Document.unscoped().findAll({
        attributes: ["id", "properties"],
        where: {
          id: documentIds,
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
        paranoid: false,
      });
      const documentsById = new Map(
        documents.map((document) => [document.id, document])
      );
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
      const documentUpdates = new Map<string, DocumentProperties>();

      for (const row of rows) {
        const document = documentsById.get(row.documentId);

        if (!document) {
          rowsToDelete.push(row.id);
          continue;
        }

        const currentProperties = documentUpdates.get(document.id) ?? {
          ...toDocumentPropertyValues(document.properties ?? {}),
        };
        const nextProperties = documentUpdates.get(document.id) ?? {
          ...currentProperties,
        };
        const normalized = sanitizeStoredPropertyValue(definition, row.value);
        const nextValue =
          normalized === null && definition.required
            ? emptyPropertyValue(definition)
            : normalized;

        if (nextValue === null) {
          delete nextProperties[definition.id];
          rowsToDelete.push(row.id);
        } else {
          nextProperties[definition.id] = nextValue;

          if (!isSameJSONValue(row.value, nextValue)) {
            rowsToUpsert.push({
              id: row.id,
              documentId: row.documentId,
              propertyDefinitionId: row.propertyDefinitionId,
              value: nextValue,
              teamId: row.teamId,
              createdById: row.createdById,
              lastModifiedById: userId,
            });
          }
        }

        if (!isSameJSONValue(currentProperties, nextProperties)) {
          documentUpdates.set(document.id, nextProperties);
        }
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

      await Promise.all(
        Array.from(documentUpdates.entries()).map(([documentId, properties]) =>
          Document.unscoped().update(
            { properties },
            {
              where: {
                id: documentId,
              },
              hooks: false,
              silent: true,
              transaction,
            }
          )
        )
      );

      return {
        processedDocuments: documentIds.length,
        updatedDocuments: documentUpdates.size,
        deletedRows: rowsToDelete.length,
        upsertedRows: rowsToUpsert.length,
        lastProcessedRowId: rows[rows.length - 1]?.id,
      };
    });

    if (!chunk) {
      break;
    }

    result.processedDocuments += chunk.processedDocuments;
    result.updatedDocuments += chunk.updatedDocuments;
    result.deletedRows += chunk.deletedRows;
    result.upsertedRows += chunk.upsertedRows;
    lastRowId = chunk.lastProcessedRowId;
  }

  await sequelize.query(
    `UPDATE documents AS d
     SET properties = COALESCE(d.properties, '{}'::jsonb) - :propertyDefinitionId
     WHERE d."teamId" = :teamId
       AND COALESCE(d.properties, '{}'::jsonb) ? :propertyDefinitionId
       AND NOT EXISTS (
         SELECT 1
         FROM document_properties AS dp
         WHERE dp."documentId" = d.id
           AND dp."propertyDefinitionId" = :propertyDefinitionId
       )`,
    {
      replacements: {
        teamId: definition.teamId,
        propertyDefinitionId: definition.id,
      },
    }
  );

  return result;
}

function sanitizeStoredPropertyValue(
  definition: PropertyDefinition,
  value: JSONValue | null,
  validUserIds?: Set<string>
): JSONValue | null {
  if (value === null || value === undefined) {
    return null;
  }

  const optionsById = new Set(
    (definition.options ?? []).map((option) => option.id)
  );

  switch (definition.type) {
    case DocumentPropertyType.Text: {
      return typeof value === "string" ? value : null;
    }

    case DocumentPropertyType.Number: {
      if (value === "") {
        return "";
      }

      return typeof value === "number" && Number.isFinite(value) ? value : null;
    }

    case DocumentPropertyType.Date: {
      if (value === "") {
        return "";
      }

      return typeof value === "string" && !Number.isNaN(Date.parse(value))
        ? value
        : null;
    }

    case DocumentPropertyType.Select: {
      if (value === "") {
        return "";
      }

      if (typeof value !== "string") {
        return null;
      }

      return optionsById.has(value) ? value : null;
    }

    case DocumentPropertyType.MultiSelect: {
      if (!isStringArray(value)) {
        return null;
      }

      if (value.length === 0) {
        return [];
      }

      const uniqueValidOptionIds = Array.from(
        new Set(value.filter((optionId) => optionsById.has(optionId)))
      );

      return uniqueValidOptionIds.length > 0 ? uniqueValidOptionIds : null;
    }

    case DocumentPropertyType.User: {
      if (!isStringArray(value)) {
        return null;
      }

      if (value.length === 0) {
        return [];
      }

      const uniqueValidUserIds = Array.from(
        new Set(
          validUserIds
            ? value.filter((userId) => validUserIds.has(userId))
            : value
        )
      );

      return uniqueValidUserIds.length > 0 ? uniqueValidUserIds : null;
    }

    default:
      return null;
  }
}

function isSameJSONValue(
  left: JSONValue | DocumentProperties | null,
  right: JSONValue | DocumentProperties | null
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizePropertyValue(
  definition: PropertyDefinition,
  value: JSONValue | null,
  validUserIds?: Set<string>
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

      return value;
    }

    case DocumentPropertyType.Number: {
      if (value === "") {
        return "";
      }

      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw ValidationError(
          `Expected numeric value for "${definition.name}"`
        );
      }

      return value;
    }

    case DocumentPropertyType.Date: {
      if (value === "") {
        return "";
      }

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
        return "";
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
        return [];
      }

      for (const optionId of value) {
        if (!optionsById.has(optionId)) {
          throw ValidationError(`Invalid option ID for "${definition.name}"`);
        }
      }

      return Array.from(new Set(value));
    }

    case DocumentPropertyType.User: {
      if (!isStringArray(value)) {
        throw ValidationError(`Expected user ID array for "${definition.name}"`);
      }

      if (value.length === 0) {
        return [];
      }

      const uniqueUserIds = Array.from(new Set(value));

      for (const userId of uniqueUserIds) {
        if (!validUserIds?.has(userId)) {
          throw ValidationError(`Invalid user ID for "${definition.name}"`);
        }
      }

      return uniqueUserIds;
    }

    default:
      throw ValidationError(`Unsupported property type "${definition.type}"`);
  }
}

function hydrateRequiredPropertyValue(
  definition: PropertyDefinition,
  value: JSONValue | null
): JSONValue {
  return value ?? emptyPropertyValue(definition);
}

function emptyPropertyValue(definition: PropertyDefinition): JSONValue {
  switch (definition.type) {
    case DocumentPropertyType.MultiSelect:
    case DocumentPropertyType.User:
      return [];
    case DocumentPropertyType.Text:
    case DocumentPropertyType.Number:
    case DocumentPropertyType.Date:
    case DocumentPropertyType.Select:
      return "";
    default:
      return "";
  }
}

async function resolveTeamUserIds(
  teamId: string,
  userIds: string[],
  transaction?: Transaction
) {
  if (userIds.length === 0) {
    return new Set<string>();
  }

  const users = await User.findAll({
    attributes: ["id"],
    where: {
      id: userIds,
      teamId,
    },
    transaction,
  });

  return new Set(users.map((user) => user.id));
}

function addUnique(items: string[], value: string) {
  if (!items.includes(value)) {
    items.push(value);
  }
}

function removeValue(items: string[], value: string) {
  const index = items.indexOf(value);

  if (index >= 0) {
    items.splice(index, 1);
  }
}

function replaceUpsert(
  upserts: DocumentPropertyUpdatePlan["upserts"],
  next: DocumentPropertyUpdatePlan["upserts"][number]
) {
  const existing = upserts.findIndex(
    (upsert) => upsert.propertyDefinitionId === next.propertyDefinitionId
  );

  if (existing >= 0) {
    upserts[existing] = next;
    return;
  }

  upserts.push(next);
}

function isStringArray(value: JSONValue): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
