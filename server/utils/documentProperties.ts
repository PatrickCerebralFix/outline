import type { DocumentPropertyValues, JSONValue } from "@shared/types";

export interface DocumentPropertyValuesInput extends DocumentPropertyValues {}
export interface DocumentPropertyValuesOutput extends DocumentPropertyValues {}

/**
 * Returns document properties in their canonical flat value form.
 *
 * @param properties Property map keyed by definition ID.
 * @returns Flat value map keyed by definition ID.
 */
export function toDocumentPropertyValues(
  properties: DocumentPropertyValuesInput
): DocumentPropertyValuesOutput {
  return properties;
}
