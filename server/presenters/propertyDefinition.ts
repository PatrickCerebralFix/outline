import { traceFunction } from "@server/logging/tracing";
import type { PropertyDefinition } from "@server/models";

function presentPropertyDefinition(definition: PropertyDefinition) {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    type: definition.type,
    required: definition.required,
    collectionId: definition.collectionId,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
    deletedAt: definition.deletedAt,
    options:
      definition.options?.map((option) => ({
        id: option.id,
        label: option.label,
        value: option.value,
        color: option.color,
        index: option.index,
        createdAt: option.createdAt,
        updatedAt: option.updatedAt,
        deletedAt: option.deletedAt,
      })) ?? [],
  };
}

export default traceFunction({
  spanName: "presenters",
})(presentPropertyDefinition);
