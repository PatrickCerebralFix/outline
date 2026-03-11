import fractionalIndex from "fractional-index";
import { DocumentPropertyType } from "@shared/types";

export interface PropertyDefinitionOption {
  id?: string;
  label: string;
  value: string;
  color?: string | null;
  index?: string | null;
}

export interface PropertyDefinitionData {
  id: string;
  name: string;
  description?: string | null;
  type: DocumentPropertyType;
  options?: PropertyDefinitionOption[];
  usageCount?: number;
}

export interface CollectionPropertyShadow {
  sourceCollectionId: string;
  sourceCollectionName: string;
  required: boolean;
  inheritToChildren: boolean;
  index: string | null;
}

export interface CollectionPropertyDefinitionRow {
  id: string;
  collectionId: string;
  propertyDefinitionId: string;
  sourceCollectionId: string;
  sourceCollectionName?: string;
  state: "attached" | "excluded";
  required: boolean;
  inheritToChildren: boolean;
  index: string | null;
  isInherited: boolean;
  isCustomized: boolean;
  isOverwritten?: boolean;
  isHidden?: boolean;
  shadowed?: CollectionPropertyShadow;
  definition: PropertyDefinitionData;
}

export interface CollectionPropertyDefinitionsSnapshot {
  effective: CollectionPropertyDefinitionRow[];
  hidden: CollectionPropertyDefinitionRow[];
  local: CollectionPropertyDefinitionRow[];
  available: PropertyDefinitionData[];
}

export interface DraftCollectionPropertyDefinitionRow {
  propertyDefinitionId: string;
  state: "attached" | "excluded";
  required: boolean;
  inheritToChildren: boolean;
  index: string | null;
}

export interface CollectionPropertyDisplayRow {
  propertyDefinitionId: string;
  definition: PropertyDefinitionData;
  status: "direct" | "inherited" | "overwritten" | "hidden";
  sourceCollectionId: string;
  sourceCollectionName?: string;
  required: boolean;
  inheritToChildren: boolean;
  index: string | null;
  local?: DraftCollectionPropertyDefinitionRow;
  shadowed?: CollectionPropertyShadow;
}

export interface DerivedCollectionPropertyDefinitionsState {
  effective: CollectionPropertyDisplayRow[];
  hidden: CollectionPropertyDisplayRow[];
  available: PropertyDefinitionData[];
  definitionCatalog: PropertyDefinitionData[];
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

function sortDisplayRows(rows: CollectionPropertyDisplayRow[]) {
  return [...rows].sort((a, b) => {
    const indexCompare = compareNullableIndex(a.index, b.index);
    if (indexCompare !== 0) {
      return indexCompare;
    }

    return a.definition.name.localeCompare(b.definition.name);
  });
}

function sortDraftRows(rows: DraftCollectionPropertyDefinitionRow[]) {
  return [...rows].sort((a, b) => {
    const indexCompare = compareNullableIndex(a.index, b.index);
    if (indexCompare !== 0) {
      return indexCompare;
    }

    return a.propertyDefinitionId.localeCompare(b.propertyDefinitionId);
  });
}

function buildDefinitionCatalog(
  snapshot: CollectionPropertyDefinitionsSnapshot
): PropertyDefinitionData[] {
  const byId = new Map<string, PropertyDefinitionData>();

  for (const definition of snapshot.available) {
    byId.set(definition.id, definition);
  }

  for (const row of [
    ...snapshot.effective,
    ...snapshot.hidden,
    ...snapshot.local,
  ]) {
    byId.set(row.propertyDefinitionId, row.definition);
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function toInheritedBaseRow(
  row: CollectionPropertyDefinitionRow
): CollectionPropertyDisplayRow {
  return {
    propertyDefinitionId: row.propertyDefinitionId,
    definition: row.definition,
    status: "inherited",
    sourceCollectionId: row.sourceCollectionId,
    sourceCollectionName: row.sourceCollectionName,
    required: row.required,
    inheritToChildren: row.inheritToChildren,
    index: row.index,
    shadowed: row.shadowed,
  };
}

function toShadowedBaseRow(
  row: CollectionPropertyDefinitionRow
): CollectionPropertyDisplayRow | undefined {
  if (!row.shadowed) {
    return undefined;
  }

  return {
    propertyDefinitionId: row.propertyDefinitionId,
    definition: row.definition,
    status: "inherited",
    sourceCollectionId: row.shadowed.sourceCollectionId,
    sourceCollectionName: row.shadowed.sourceCollectionName,
    required: row.shadowed.required,
    inheritToChildren: row.shadowed.inheritToChildren,
    index: row.shadowed.index,
    shadowed: row.shadowed,
  };
}

function buildInheritedBases(
  snapshot: CollectionPropertyDefinitionsSnapshot,
  collectionId: string
) {
  const inheritedByDefinitionId = new Map<
    string,
    CollectionPropertyDisplayRow
  >();

  for (const row of snapshot.effective) {
    const inheritedBase =
      row.sourceCollectionId !== collectionId
        ? toInheritedBaseRow(row)
        : toShadowedBaseRow(row);

    if (inheritedBase) {
      inheritedByDefinitionId.set(row.propertyDefinitionId, inheritedBase);
    }
  }

  for (const row of snapshot.hidden) {
    inheritedByDefinitionId.set(
      row.propertyDefinitionId,
      toInheritedBaseRow(row)
    );
  }

  return inheritedByDefinitionId;
}

/**
 * Converts local collection rows into minimal draft rows for editing.
 *
 * @param rows The local rows returned by the API.
 * @returns The normalized draft rows.
 */
export function toDraftRows(rows: CollectionPropertyDefinitionRow[]) {
  return sortDraftRows(
    rows.map((row) => ({
      propertyDefinitionId: row.propertyDefinitionId,
      state: row.state,
      required: row.required,
      inheritToChildren: row.inheritToChildren,
      index: row.index,
    }))
  );
}

/**
 * Compares two draft row arrays for save equality.
 *
 * @param left The first draft row list.
 * @param right The second draft row list.
 * @returns Whether the draft rows are equivalent.
 */
export function equalDraftRows(
  left: DraftCollectionPropertyDefinitionRow[],
  right: DraftCollectionPropertyDefinitionRow[]
) {
  return (
    JSON.stringify(sortDraftRows(left)) === JSON.stringify(sortDraftRows(right))
  );
}

/**
 * Inserts or replaces a draft row by property definition ID.
 *
 * @param rows The existing draft rows.
 * @param nextRow The row to insert.
 * @returns The updated draft row list.
 */
export function upsertDraftRow(
  rows: DraftCollectionPropertyDefinitionRow[],
  nextRow: DraftCollectionPropertyDefinitionRow
) {
  return sortDraftRows([
    ...rows.filter(
      (row) => row.propertyDefinitionId !== nextRow.propertyDefinitionId
    ),
    nextRow,
  ]);
}

/**
 * Removes a draft row by property definition ID.
 *
 * @param rows The existing draft rows.
 * @param propertyDefinitionId The property definition to remove.
 * @returns The updated draft row list.
 */
export function removeDraftRow(
  rows: DraftCollectionPropertyDefinitionRow[],
  propertyDefinitionId: string
) {
  return sortDraftRows(
    rows.filter((row) => row.propertyDefinitionId !== propertyDefinitionId)
  );
}

/**
 * Creates the next fractional index before the supplied visible rows.
 *
 * @param rows The visible effective rows.
 * @returns The previous fractional index.
 */
export function createPreviousIndex(rows: CollectionPropertyDisplayRow[]) {
  const firstIndex = [...rows]
    .sort((a, b) => compareNullableIndex(a.index, b.index))
    .at(0)?.index;

  return fractionalIndex(null, firstIndex ?? null);
}

/**
 * Derives effective, hidden, and available rows from a server snapshot and draft rows.
 *
 * @param snapshot The latest server snapshot.
 * @param draftRows The current editable local rows.
 * @param collectionId The active collection ID.
 * @returns The derived property editor state.
 */
export function deriveCollectionPropertyDefinitionsState({
  snapshot,
  draftRows,
  collectionId,
}: {
  snapshot: CollectionPropertyDefinitionsSnapshot;
  draftRows: DraftCollectionPropertyDefinitionRow[];
  collectionId: string;
}): DerivedCollectionPropertyDefinitionsState {
  const definitionCatalog = buildDefinitionCatalog(snapshot);
  const definitionById = new Map(
    definitionCatalog.map((definition) => [definition.id, definition])
  );
  const inheritedByDefinitionId = buildInheritedBases(snapshot, collectionId);
  const draftByDefinitionId = new Map(
    draftRows.map((row) => [row.propertyDefinitionId, row])
  );
  const definitionIds = new Set<string>([
    ...inheritedByDefinitionId.keys(),
    ...draftByDefinitionId.keys(),
  ]);
  const effective: CollectionPropertyDisplayRow[] = [];
  const hidden: CollectionPropertyDisplayRow[] = [];

  for (const propertyDefinitionId of definitionIds) {
    const draftRow = draftByDefinitionId.get(propertyDefinitionId);
    const inheritedBase = inheritedByDefinitionId.get(propertyDefinitionId);
    const definition =
      definitionById.get(propertyDefinitionId) ?? inheritedBase?.definition;

    if (draftRow) {
      if (draftRow.state === "excluded") {
        if (!inheritedBase) {
          continue;
        }

        hidden.push({
          ...inheritedBase,
          status: "hidden",
          local: draftRow,
        });
        continue;
      }

      if (!definition) {
        continue;
      }

      if (inheritedBase) {
        effective.push({
          propertyDefinitionId,
          definition,
          status: "overwritten",
          sourceCollectionId: inheritedBase.sourceCollectionId,
          sourceCollectionName: inheritedBase.sourceCollectionName,
          required: draftRow.required,
          inheritToChildren: draftRow.inheritToChildren,
          index: draftRow.index,
          local: draftRow,
          shadowed: inheritedBase.shadowed,
        });
        continue;
      }

      effective.push({
        propertyDefinitionId,
        definition,
        status: "direct",
        sourceCollectionId: collectionId,
        required: draftRow.required,
        inheritToChildren: draftRow.inheritToChildren,
        index: draftRow.index,
        local: draftRow,
      });
      continue;
    }

    if (inheritedBase) {
      effective.push(inheritedBase);
    }
  }

  const unavailableDefinitionIds = new Set(
    [...effective, ...hidden].map((row) => row.propertyDefinitionId)
  );

  return {
    effective: sortDisplayRows(effective),
    hidden: sortDisplayRows(hidden),
    available: definitionCatalog.filter(
      (definition) => !unavailableDefinitionIds.has(definition.id)
    ),
    definitionCatalog,
  };
}
