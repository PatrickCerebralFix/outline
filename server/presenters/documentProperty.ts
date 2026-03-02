import { traceFunction } from "@server/logging/tracing";
import type { DocumentProperty } from "@server/models";

function presentDocumentProperty(documentProperty: DocumentProperty) {
  return {
    id: documentProperty.id,
    documentId: documentProperty.documentId,
    propertyDefinitionId: documentProperty.propertyDefinitionId,
    value: documentProperty.value,
    createdAt: documentProperty.createdAt,
    updatedAt: documentProperty.updatedAt,
  };
}

export default traceFunction({
  spanName: "presenters",
})(presentDocumentProperty);
