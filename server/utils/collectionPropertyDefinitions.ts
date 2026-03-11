import fractionalIndex from "fractional-index";
import { Op } from "sequelize";
import type { Transaction } from "sequelize";
import { CollectionPropertyDefinitionState } from "@shared/types";
import { ValidationError } from "@server/errors";
import {
  Collection,
  CollectionPropertyDefinition,
  Document,
  DocumentProperty,
  PropertyDefinition,
} from "@server/models";

export interface ResolvedCollectionPropertyDefinition {
  id: string;
  collectionId: string;
  propertyDefinitionId: string;
  sourceCollectionId: string;
  sourceCollectionName: string;
  state: CollectionPropertyDefinitionState;
  required: boolean;
  inheritToChildren: boolean;
  index: string | null;
  isInherited: boolean;
  isCustomized: boolean;
  isOverwritten: boolean;
  shadowed?: {
    sourceCollectionId: string;
    sourceCollectionName: string;
    required: boolean;
    inheritToChildren: boolean;
    index: string | null;
  };
  definition: PropertyDefinition;
}

export interface SaveCollectionPropertyDefinitionInputRow {
  propertyDefinitionId: string;
  state: CollectionPropertyDefinitionState;
  required?: boolean;
  inheritToChildren?: boolean;
  index?: string | null;
}

export interface WorkspaceCollectionPropertySummary {
  id: string;
  name: string;
  parentCollectionId: string | null;
  index: string;
  propertyCount: number;
}

interface CollectionResolutionNode {
  id: string;
  name: string;
  parentCollectionId: string | null;
}

interface EffectivePropertyDefinitionIds {
  effective: Set<string>;
  outgoing: Set<string>;
}

type SaveCollectionPropertyDefinitionsOptions = {
  collectionId: string;
  teamId: string;
  userId: string;
  rows: SaveCollectionPropertyDefinitionInputRow[];
  transaction: Transaction;
  replaceLocal?: boolean;
};

interface ResolvedCollectionPropertyDefinitionMaps {
  effective: Map<string, ResolvedCollectionPropertyDefinition>;
  outgoing: Map<string, ResolvedCollectionPropertyDefinition>;
}

/**
 * Resolves the effective property definitions for a collection, including
 * inherited parent associations and local exclusions.
 *
 * @param collectionId The collection to resolve effective properties for.
 * @param teamId The owning team ID.
 * @param transaction Optional transaction for consistent reads.
 * @returns Effective definitions plus the local rows for the target collection.
 */
export async function resolveCollectionPropertyDefinitions(
  collectionId: string,
  teamId: string,
  transaction?: Transaction
): Promise<{
  effective: ResolvedCollectionPropertyDefinition[];
  hidden: ResolvedCollectionPropertyDefinition[];
  local: ResolvedCollectionPropertyDefinition[];
}> {
  const chain = await loadCollectionChain(collectionId, transaction);
  const chainIds = chain.map((collection) => collection.id);

  if (chainIds.length === 0) {
    return {
      effective: [],
      hidden: [],
      local: [],
    };
  }

  const explicitRows = await loadExplicitCollectionPropertyDefinitions(
    chainIds,
    teamId,
    transaction
  );

  const rowsByCollectionId = new Map<string, CollectionPropertyDefinition[]>();
  for (const row of explicitRows) {
    const existing = rowsByCollectionId.get(row.collectionId) ?? [];
    existing.push(row);
    rowsByCollectionId.set(row.collectionId, existing);
  }
  const localRows: ResolvedCollectionPropertyDefinition[] = [];
  const hiddenRows: ResolvedCollectionPropertyDefinition[] = [];
  let resolved: ResolvedCollectionPropertyDefinitionMaps = {
    effective: new Map(),
    outgoing: new Map(),
  };

  for (const collection of chain) {
    const explicitForCollection = rowsByCollectionId.get(collection.id) ?? [];
    const incoming = resolved.outgoing;
    resolved = applyCollectionPropertyRows({
      targetCollectionId: collectionId,
      collectionId: collection.id,
      collectionName: collection.name,
      explicitRows: explicitForCollection,
      incoming,
    });

    if (collection.id === collectionId) {
      for (const row of explicitForCollection) {
        const inheritedRow = incoming.get(row.propertyDefinitionId);

        if (
          row.state === CollectionPropertyDefinitionState.Excluded &&
          inheritedRow
        ) {
          hiddenRows.push({
            ...inheritedRow,
            id: row.id,
            collectionId,
            state: CollectionPropertyDefinitionState.Excluded,
            required: inheritedRow.required,
            inheritToChildren: inheritedRow.inheritToChildren,
            index: inheritedRow.index,
            isInherited: true,
            isCustomized: true,
            isOverwritten: false,
            shadowed: toShadowedMetadata(inheritedRow),
          });
        }

        const currentLocalRow = resolved.effective.get(
          row.propertyDefinitionId
        );

        if (currentLocalRow) {
          const nextLocalRow =
            row.state === CollectionPropertyDefinitionState.Attached &&
            !!inheritedRow
              ? {
                  ...currentLocalRow,
                  isOverwritten: true,
                  shadowed:
                    currentLocalRow.shadowed ??
                    toShadowedMetadata(inheritedRow),
                }
              : currentLocalRow;

          if (nextLocalRow !== currentLocalRow) {
            resolved.effective.set(row.propertyDefinitionId, nextLocalRow);
          }

          localRows.push(nextLocalRow);
          continue;
        }

        localRows.push(
          toResolvedRow({
            id: row.id,
            targetCollectionId: collectionId,
            sourceCollectionId: collection.id,
            sourceCollectionName: collection.name,
            state: row.state,
            required: row.required,
            inheritToChildren: row.inheritToChildren,
            index: row.index,
            definition: row.propertyDefinition,
            previous: incoming.get(row.propertyDefinitionId),
          })
        );
      }
    }
  }

  return {
    effective: sortResolvedCollectionPropertyDefinitions(
      Array.from(resolved.effective.values())
    ),
    hidden: sortResolvedCollectionPropertyDefinitions(hiddenRows),
    local: sortResolvedCollectionPropertyDefinitions(localRows),
  };
}

/**
 * Saves the direct collection-level property association rows for a single
 * collection.
 *
 * @param options The rows to save and metadata for the write.
 * @returns The direct rows after persistence.
 */
export async function saveCollectionPropertyDefinitions(
  options: SaveCollectionPropertyDefinitionsOptions
): Promise<CollectionPropertyDefinition[]> {
  const { collectionId, teamId, userId, rows, transaction, replaceLocal } =
    options;

  const uniqueDefinitionIds = Array.from(
    new Set(rows.map((row) => row.propertyDefinitionId))
  );
  const definitions =
    uniqueDefinitionIds.length > 0
      ? await PropertyDefinition.findAll({
          where: {
            id: uniqueDefinitionIds,
            teamId,
            deletedAt: null,
          },
          transaction,
        })
      : [];
  const definitionIds = new Set(definitions.map((definition) => definition.id));

  if (definitionIds.size !== uniqueDefinitionIds.length) {
    throw ValidationError("One or more property definitions are invalid");
  }

  const existingRows = await CollectionPropertyDefinition.findAll({
    where: {
      collectionId,
      teamId,
      deletedAt: null,
    },
    transaction,
  });
  const existingByDefinitionId = new Map(
    existingRows.map((row) => [row.propertyDefinitionId, row])
  );
  const keepDefinitionIds = new Set<string>();

  let previousIndex =
    existingRows
      .filter((row) => row.state === CollectionPropertyDefinitionState.Attached)
      .sort((a, b) => compareNullableIndex(a.index, b.index))
      .at(-1)?.index ?? null;

  for (const [rowIndex, row] of rows.entries()) {
    const existing = existingByDefinitionId.get(row.propertyDefinitionId);
    const nextIndex =
      row.state === CollectionPropertyDefinitionState.Attached
        ? (row.index ?? fractionalIndex(previousIndex, null))
        : null;

    if (row.state === CollectionPropertyDefinitionState.Attached) {
      previousIndex = nextIndex;
    }

    if (existing) {
      existing.state = row.state;
      existing.required =
        row.state === CollectionPropertyDefinitionState.Attached
          ? !!row.required
          : false;
      existing.inheritToChildren =
        row.state === CollectionPropertyDefinitionState.Attached
          ? (row.inheritToChildren ?? true)
          : false;
      existing.index = nextIndex;
      existing.lastModifiedById = userId;
      await existing.save({ transaction });
      keepDefinitionIds.add(existing.propertyDefinitionId);
      continue;
    }

    await CollectionPropertyDefinition.create(
      {
        collectionId,
        propertyDefinitionId: row.propertyDefinitionId,
        state: row.state,
        required:
          row.state === CollectionPropertyDefinitionState.Attached
            ? !!row.required
            : false,
        inheritToChildren:
          row.state === CollectionPropertyDefinitionState.Attached
            ? (row.inheritToChildren ?? true)
            : false,
        index:
          row.state === CollectionPropertyDefinitionState.Attached
            ? (nextIndex ?? `${rowIndex}`)
            : null,
        teamId,
        createdById: userId,
        lastModifiedById: userId,
      },
      {
        transaction,
      }
    );
    keepDefinitionIds.add(row.propertyDefinitionId);
  }

  if (replaceLocal) {
    const deleteIds = existingRows
      .filter((row) => !keepDefinitionIds.has(row.propertyDefinitionId))
      .map((row) => row.id);

    if (deleteIds.length > 0) {
      await CollectionPropertyDefinition.destroy({
        where: {
          id: deleteIds,
        },
        transaction,
      });
    }
  }

  return CollectionPropertyDefinition.findAll({
    where: {
      collectionId,
      teamId,
      deletedAt: null,
    },
    transaction,
  });
}

/**
 * Ensures the supplied property definitions are directly attached to the
 * target collection.
 *
 * @param collectionId The collection to attach the properties to.
 * @param propertyDefinitionIds The property definitions to attach.
 * @param teamId The owning team ID.
 * @param userId The acting user ID.
 * @param transaction The active transaction.
 */
export async function attachPropertyDefinitionsToCollection({
  collectionId,
  propertyDefinitionIds,
  teamId,
  userId,
  transaction,
}: {
  collectionId: string;
  propertyDefinitionIds: string[];
  teamId: string;
  userId: string;
  transaction: Transaction;
}) {
  if (propertyDefinitionIds.length === 0) {
    return;
  }

  const current = await resolveCollectionPropertyDefinitions(
    collectionId,
    teamId,
    transaction
  );
  const effectiveByDefinitionId = new Map(
    current.effective.map((row) => [row.propertyDefinitionId, row])
  );
  const localByDefinitionId = new Map(
    current.local.map((row) => [row.propertyDefinitionId, row])
  );
  const rows: SaveCollectionPropertyDefinitionInputRow[] = current.local.map(
    (row) => ({
      propertyDefinitionId: row.propertyDefinitionId,
      state: row.state,
      required: row.required,
      inheritToChildren: row.inheritToChildren,
      index: row.index,
    })
  );

  let previousIndex =
    rows
      .filter((row) => row.state === CollectionPropertyDefinitionState.Attached)
      .sort((a, b) => compareNullableIndex(a.index ?? null, b.index ?? null))
      .at(-1)?.index ?? null;

  for (const propertyDefinitionId of propertyDefinitionIds) {
    const existingLocal = localByDefinitionId.get(propertyDefinitionId);

    if (existingLocal) {
      if (existingLocal.state === CollectionPropertyDefinitionState.Excluded) {
        const nextIndex = fractionalIndex(previousIndex, null);
        previousIndex = nextIndex;
        rows.splice(
          rows.findIndex(
            (row) => row.propertyDefinitionId === propertyDefinitionId
          ),
          1,
          {
            propertyDefinitionId,
            state: CollectionPropertyDefinitionState.Attached,
            required:
              effectiveByDefinitionId.get(propertyDefinitionId)?.required ??
              false,
            inheritToChildren:
              effectiveByDefinitionId.get(propertyDefinitionId)
                ?.inheritToChildren ?? true,
            index: nextIndex,
          }
        );
      }
      continue;
    }

    const effective = effectiveByDefinitionId.get(propertyDefinitionId);
    const nextIndex = fractionalIndex(previousIndex, null);
    previousIndex = nextIndex;
    rows.push({
      propertyDefinitionId,
      state: CollectionPropertyDefinitionState.Attached,
      required: effective?.required ?? false,
      inheritToChildren: effective?.inheritToChildren ?? true,
      index: nextIndex,
    });
  }

  await saveCollectionPropertyDefinitions({
    collectionId,
    teamId,
    userId,
    rows,
    transaction,
    replaceLocal: true,
  });
}

/**
 * Removes non-applicable property values for a set of documents and keeps only
 * the provided definition IDs.
 *
 * @param documentIds The documents to prune.
 * @param keepDefinitionIds The property definition IDs to keep.
 * @param transaction The active transaction.
 */
export async function pruneDocumentPropertiesToDefinitionIds(
  documentIds: string[],
  keepDefinitionIds: string[],
  transaction: Transaction
) {
  if (documentIds.length === 0) {
    return;
  }

  const keepSet = new Set(keepDefinitionIds);
  const documents = await Document.unscoped().findAll({
    attributes: ["id", "properties"],
    where: {
      id: documentIds,
    },
    transaction,
    lock: transaction.LOCK.UPDATE,
    paranoid: false,
  });

  await Promise.all(
    documents.map(async (document) => {
      const nextProperties = Object.fromEntries(
        Object.entries(document.properties ?? {}).filter(([definitionId]) =>
          keepSet.has(definitionId)
        )
      );

      await Document.unscoped().update(
        {
          properties: nextProperties,
        },
        {
          where: {
            id: document.id,
          },
          hooks: false,
          silent: true,
          transaction,
        }
      );
    })
  );

  if (keepDefinitionIds.length === 0) {
    await DocumentProperty.destroy({
      where: {
        documentId: documentIds,
      },
      transaction,
    });
    return;
  }

  await DocumentProperty.destroy({
    where: {
      documentId: documentIds,
      propertyDefinitionId: {
        [Op.notIn]: keepDefinitionIds,
      },
    },
    transaction,
  });
}

/**
 * Lists active workspace collections with their effective property counts.
 *
 * @param teamId The owning team ID.
 * @param transaction Optional transaction for consistent reads.
 * @returns Active collections and their effective property counts.
 */
export async function listWorkspaceCollectionPropertySummaries(
  teamId: string,
  transaction?: Transaction
): Promise<WorkspaceCollectionPropertySummary[]> {
  const collections = await Collection.findAll({
    attributes: ["id", "name", "parentCollectionId", "index"],
    where: {
      teamId,
      archivedAt: null,
      deletedAt: null,
    },
    transaction,
  });

  if (collections.length === 0) {
    return [];
  }

  const collectionIds = collections.map((collection) => collection.id);
  const explicitRows = await CollectionPropertyDefinition.findAll({
    attributes: [
      "collectionId",
      "propertyDefinitionId",
      "state",
      "inheritToChildren",
    ],
    where: {
      collectionId: collectionIds,
      teamId,
      deletedAt: null,
    },
    transaction,
  });

  const collectionsById = new Map(
    collections.map((collection) => [collection.id, collection])
  );
  const rowsByCollectionId = new Map<string, CollectionPropertyDefinition[]>();

  for (const row of explicitRows) {
    const existing = rowsByCollectionId.get(row.collectionId) ?? [];
    existing.push(row);
    rowsByCollectionId.set(row.collectionId, existing);
  }

  const resolvedPropertyIdsByCollectionId = new Map<
    string,
    { effective: Set<string>; outgoing: Set<string> }
  >();

  const resolvePropertyIds = (
    collectionId: string
  ): { effective: Set<string>; outgoing: Set<string> } => {
    const cached = resolvedPropertyIdsByCollectionId.get(collectionId);

    if (cached) {
      return cached;
    }

    const collection = collectionsById.get(collectionId);
    if (!collection) {
      return {
        effective: new Set(),
        outgoing: new Set(),
      };
    }

    const inherited = collection.parentCollectionId
      ? resolvePropertyIds(collection.parentCollectionId).outgoing
      : new Set<string>();
    const effective = new Set(inherited);
    const outgoing = new Set(inherited);

    for (const row of rowsByCollectionId.get(collectionId) ?? []) {
      if (row.state === CollectionPropertyDefinitionState.Excluded) {
        effective.delete(row.propertyDefinitionId);
        outgoing.delete(row.propertyDefinitionId);
        continue;
      }

      effective.add(row.propertyDefinitionId);

      if (row.inheritToChildren) {
        outgoing.add(row.propertyDefinitionId);
      } else {
        outgoing.delete(row.propertyDefinitionId);
      }
    }

    const resolved = {
      effective,
      outgoing,
    };
    resolvedPropertyIdsByCollectionId.set(collectionId, resolved);
    return resolved;
  };

  return collections.map((collection) => ({
    id: collection.id,
    name: collection.name,
    parentCollectionId: collection.parentCollectionId ?? null,
    index: collection.index ?? "",
    propertyCount: resolvePropertyIds(collection.id).effective.size,
  }));
}

/**
 * Resolves effective property definition IDs for multiple collections in one pass.
 *
 * @param collectionIds The target collections to resolve.
 * @param teamId The owning team ID.
 * @param transaction Optional transaction for consistent reads.
 * @returns A map of collection ID to effective property definition IDs.
 */
export async function resolveEffectivePropertyDefinitionIdsForCollections(
  collectionIds: string[],
  teamId: string,
  transaction?: Transaction
): Promise<Map<string, Set<string>>> {
  const targetCollectionIds = Array.from(new Set(collectionIds));

  if (targetCollectionIds.length === 0) {
    return new Map();
  }

  const collections = await Collection.findAll({
    attributes: ["id", "name", "parentCollectionId"],
    where: {
      teamId,
      deletedAt: null,
    },
    transaction,
    paranoid: false,
  });
  const collectionsById = new Map(
    collections.map((collection) => [
      collection.id,
      {
        id: collection.id,
        name: collection.name,
        parentCollectionId: collection.parentCollectionId,
      } satisfies CollectionResolutionNode,
    ])
  );

  const relevantCollectionIds = new Set<string>();

  for (const collectionId of targetCollectionIds) {
    let current = collectionsById.get(collectionId);

    if (!current) {
      throw ValidationError("Collection not found");
    }

    while (current) {
      relevantCollectionIds.add(current.id);
      current = current.parentCollectionId
        ? collectionsById.get(current.parentCollectionId)
        : undefined;
    }
  }

  const explicitRows = await CollectionPropertyDefinition.findAll({
    attributes: [
      "collectionId",
      "propertyDefinitionId",
      "state",
      "inheritToChildren",
    ],
    where: {
      collectionId: Array.from(relevantCollectionIds),
      teamId,
      deletedAt: null,
    },
    transaction,
  });

  const rowsByCollectionId = new Map<string, CollectionPropertyDefinition[]>();

  for (const row of explicitRows) {
    const existing = rowsByCollectionId.get(row.collectionId) ?? [];
    existing.push(row);
    rowsByCollectionId.set(row.collectionId, existing);
  }

  const resolvedByCollectionId = new Map<string, EffectivePropertyDefinitionIds>();

  const resolveCollection = (collectionId: string): EffectivePropertyDefinitionIds => {
    const cached = resolvedByCollectionId.get(collectionId);

    if (cached) {
      return cached;
    }

    const collection = collectionsById.get(collectionId);

    if (!collection) {
      throw ValidationError("Collection not found");
    }

    const inherited = collection.parentCollectionId
      ? resolveCollection(collection.parentCollectionId).outgoing
      : new Set<string>();
    const effective = new Set(inherited);
    const outgoing = new Set(inherited);

    for (const row of rowsByCollectionId.get(collectionId) ?? []) {
      if (row.state === CollectionPropertyDefinitionState.Excluded) {
        effective.delete(row.propertyDefinitionId);
        outgoing.delete(row.propertyDefinitionId);
        continue;
      }

      effective.add(row.propertyDefinitionId);

      if (row.inheritToChildren) {
        outgoing.add(row.propertyDefinitionId);
      } else {
        outgoing.delete(row.propertyDefinitionId);
      }
    }

    const resolved = { effective, outgoing };
    resolvedByCollectionId.set(collectionId, resolved);
    return resolved;
  };

  return new Map(
    targetCollectionIds.map((collectionId) => [
      collectionId,
      new Set(resolveCollection(collectionId).effective),
    ])
  );
}

async function loadCollectionChain(
  collectionId: string,
  transaction?: Transaction
): Promise<
  Array<{ id: string; name: string; parentCollectionId: string | null }>
> {
  const chain: Array<{
    id: string;
    name: string;
    parentCollectionId: string | null;
  }> = [];
  let currentId: string | null = collectionId;

  while (currentId) {
    const foundCollection: Collection | null = await Collection.findByPk(
      currentId,
      {
        attributes: ["id", "name", "parentCollectionId"],
        transaction,
        paranoid: false,
      }
    );

    if (!foundCollection) {
      throw ValidationError("Collection not found");
    }

    chain.unshift({
      id: foundCollection.id,
      name: foundCollection.name,
      parentCollectionId: foundCollection.parentCollectionId,
    });
    currentId = foundCollection.parentCollectionId;
  }

  return chain;
}

async function loadExplicitCollectionPropertyDefinitions(
  collectionIds: string[],
  teamId: string,
  transaction?: Transaction
) {
  return CollectionPropertyDefinition.findAll({
    where: {
      collectionId: collectionIds,
      teamId,
      deletedAt: null,
    },
    include: [
      {
        association: "propertyDefinition",
        required: true,
        where: {
          teamId,
          deletedAt: null,
        },
        include: [
          {
            association: "options",
            required: false,
          },
        ],
      },
    ],
    transaction,
  });
}

function toResolvedRow({
  id,
  targetCollectionId,
  sourceCollectionId,
  sourceCollectionName,
  state,
  required,
  inheritToChildren,
  index,
  definition,
  previous,
}: {
  id: string;
  targetCollectionId: string;
  sourceCollectionId: string;
  sourceCollectionName: string;
  state: CollectionPropertyDefinitionState;
  required: boolean;
  inheritToChildren: boolean;
  index: string | null;
  definition: PropertyDefinition;
  previous?: ResolvedCollectionPropertyDefinition;
}): ResolvedCollectionPropertyDefinition {
  return {
    id,
    collectionId: targetCollectionId,
    propertyDefinitionId: definition.id,
    sourceCollectionId,
    sourceCollectionName,
    state,
    required: state === CollectionPropertyDefinitionState.Attached && required,
    inheritToChildren:
      state === CollectionPropertyDefinitionState.Attached && inheritToChildren,
    index,
    isInherited: sourceCollectionId !== targetCollectionId,
    isCustomized:
      sourceCollectionId === targetCollectionId &&
      !!previous &&
      previous.sourceCollectionId !== targetCollectionId,
    isOverwritten: false,
    shadowed:
      sourceCollectionId === targetCollectionId &&
      !!previous &&
      previous.sourceCollectionId !== targetCollectionId
        ? toShadowedMetadata(previous)
        : undefined,
    definition,
  };
}

function toShadowedMetadata(row: ResolvedCollectionPropertyDefinition) {
  return {
    sourceCollectionId: row.sourceCollectionId,
    sourceCollectionName: row.sourceCollectionName,
    required: row.required,
    inheritToChildren: row.inheritToChildren,
    index: row.index,
  };
}

function sortResolvedCollectionPropertyDefinitions(
  rows: ResolvedCollectionPropertyDefinition[]
) {
  return [...rows].sort((a, b) => {
    const indexCompare = compareNullableIndex(a.index, b.index);

    if (indexCompare !== 0) {
      return indexCompare;
    }

    return a.definition.name.localeCompare(b.definition.name);
  });
}

function applyCollectionPropertyRows({
  targetCollectionId,
  collectionId,
  collectionName,
  explicitRows,
  incoming,
}: {
  targetCollectionId: string;
  collectionId: string;
  collectionName: string;
  explicitRows: CollectionPropertyDefinition[];
  incoming: Map<string, ResolvedCollectionPropertyDefinition>;
}): ResolvedCollectionPropertyDefinitionMaps {
  const effective = new Map(incoming);
  const outgoing = new Map(incoming);

  for (const row of explicitRows) {
    const previous = effective.get(row.propertyDefinitionId);
    const resolved = toResolvedRow({
      id: row.id,
      targetCollectionId,
      sourceCollectionId: collectionId,
      sourceCollectionName: collectionName,
      state: row.state,
      required: row.required,
      inheritToChildren: row.inheritToChildren,
      index: row.index,
      definition: row.propertyDefinition,
      previous,
    });

    if (row.state === CollectionPropertyDefinitionState.Excluded) {
      effective.delete(row.propertyDefinitionId);
      outgoing.delete(row.propertyDefinitionId);
      continue;
    }

    effective.set(row.propertyDefinitionId, resolved);

    if (collectionId === targetCollectionId || row.inheritToChildren) {
      outgoing.set(row.propertyDefinitionId, resolved);
    } else {
      outgoing.delete(row.propertyDefinitionId);
    }
  }

  return {
    effective,
    outgoing,
  };
}

function compareNullableIndex(
  left: string | null,
  right: string | null
): number {
  if (left && right) {
    if (left < right) {
      return -1;
    }

    if (left > right) {
      return 1;
    }

    return 0;
  }

  if (left) {
    return -1;
  }

  if (right) {
    return 1;
  }

  return 0;
}
