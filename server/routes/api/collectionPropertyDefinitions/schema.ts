import { z } from "zod";
import {
  CollectionPropertyDefinitionState,
  DocumentPropertyType,
} from "@shared/types";
import { BaseSchema } from "@server/routes/api/schema";
import { ValidateColor } from "@server/validation";

const PropertyDefinitionOptionInputSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(255),
  value: z.string().min(1).max(255),
  color: z
    .string()
    .regex(ValidateColor.regex, { message: ValidateColor.message })
    .nullish(),
  index: z.string().max(255).nullish(),
});

export const CollectionPropertyDefinitionsListSchema = BaseSchema.extend({
  body: z.object({
    collectionId: z.string().uuid(),
    includeAvailable: z.boolean().default(true),
    includeHidden: z.boolean().default(true),
    includeLocal: z.boolean().default(true),
  }),
});

export type CollectionPropertyDefinitionsListReq = z.infer<
  typeof CollectionPropertyDefinitionsListSchema
>;

export const CollectionPropertyDefinitionsWorkspaceListSchema =
  BaseSchema.extend({
    body: z.object({}),
  });

export type CollectionPropertyDefinitionsWorkspaceListReq = z.infer<
  typeof CollectionPropertyDefinitionsWorkspaceListSchema
>;

export const CollectionPropertyDefinitionsSaveSchema = BaseSchema.extend({
  body: z.object({
    collectionId: z.string().uuid(),
    replaceLocal: z.boolean().default(false),
    definitions: z
      .array(
        z.object({
          tempId: z.string().min(1),
          name: z.string().trim().min(1).max(255),
          description: z.string().max(2000).nullish(),
          type: z.nativeEnum(DocumentPropertyType),
          options: z.array(PropertyDefinitionOptionInputSchema).default([]),
        })
      )
      .default([]),
    rows: z.array(
      z.object({
        propertyDefinitionId: z.string().min(1),
        state: z.nativeEnum(CollectionPropertyDefinitionState),
        required: z.boolean().optional(),
        inheritToChildren: z.boolean().optional(),
        index: z.string().max(255).nullish(),
      })
    ),
  }),
});

export type CollectionPropertyDefinitionsSaveReq = z.infer<
  typeof CollectionPropertyDefinitionsSaveSchema
>;

export const CollectionPropertyDefinitionsCreateSchema = BaseSchema.extend({
  body: z.object({
    collectionId: z.string().uuid(),
    name: z.string().trim().min(1).max(255),
    description: z.string().max(2000).nullish(),
    type: z.nativeEnum(DocumentPropertyType),
    options: z.array(PropertyDefinitionOptionInputSchema).default([]),
  }),
});

export type CollectionPropertyDefinitionsCreateReq = z.infer<
  typeof CollectionPropertyDefinitionsCreateSchema
>;
