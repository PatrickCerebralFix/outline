import type { DocumentPropertySnapshot, JSONValue } from "@shared/types";

export type DocumentPropertyLike = DocumentPropertySnapshot | JSONValue | null;

export interface DocumentPropertyValuesInput {
  [propertyDefinitionId: string]: DocumentPropertyLike | undefined;
}

export interface DocumentPropertyValuesOutput {
  [propertyDefinitionId: string]: JSONValue | null | undefined;
}

/**
 * Extracts a primitive property value from either snapshot or flat formats.
 *
 * @param property The document property in snapshot or flat format.
 * @returns The extracted primitive value.
 */
export function extractDocumentPropertyValue(
  property: DocumentPropertyLike | undefined
): JSONValue | null {
  if (property === null || property === undefined) {
    return null;
  }

  if (
    typeof property === "object" &&
    !Array.isArray(property) &&
    "value" in property
  ) {
    return property.value ?? null;
  }

  return property;
}

/**
 * Converts snapshot-shaped properties to flat value maps.
 *
 * @param properties Property map keyed by definition ID.
 * @returns Flat value map keyed by definition ID.
 */
export function toDocumentPropertyValues(
  properties: DocumentPropertyValuesInput
): DocumentPropertyValuesOutput {
  return Object.fromEntries(
    Object.entries(properties).map(([propertyDefinitionId, property]) => [
      propertyDefinitionId,
      extractDocumentPropertyValue(property),
    ])
  );
}
