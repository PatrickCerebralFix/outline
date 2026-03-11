import { traceFunction } from "@server/logging/tracing";
import type { PropertyDefinition } from "@server/models";

function presentPropertyDefinition(
  definition: PropertyDefinition,
  options?: {
    usageCount?: number;
  }
) {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    type: definition.type,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
    deletedAt: definition.deletedAt,
    usageCount: options?.usageCount,
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
