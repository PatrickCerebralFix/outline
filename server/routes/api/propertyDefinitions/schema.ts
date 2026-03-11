import { z } from "zod";
import { DocumentPropertyType } from "@shared/types";
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

const BaseIdSchema = z.object({
  id: z.string().uuid(),
});

export const PropertyDefinitionsListSchema = BaseSchema.extend({
  body: z.object({}),
});

export type PropertyDefinitionsListReq = z.infer<
  typeof PropertyDefinitionsListSchema
>;

export const PropertyDefinitionsCreateSchema = BaseSchema.extend({
  body: z.object({
    name: z.string().trim().min(1).max(255),
    description: z.string().max(2000).nullish(),
    type: z.nativeEnum(DocumentPropertyType),
    options: z.array(PropertyDefinitionOptionInputSchema).default([]),
  }),
});

export type PropertyDefinitionsCreateReq = z.infer<
  typeof PropertyDefinitionsCreateSchema
>;

export const PropertyDefinitionsUpdateSchema = BaseSchema.extend({
  body: BaseIdSchema.extend({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(2000).nullish(),
    options: z.array(PropertyDefinitionOptionInputSchema).optional(),
  }),
}).refine(
  (req) =>
    req.body.name !== undefined ||
    req.body.description !== undefined ||
    req.body.options !== undefined,
  {
    message: "At least one field must be provided to update",
  }
);

export type PropertyDefinitionsUpdateReq = z.infer<
  typeof PropertyDefinitionsUpdateSchema
>;

export const PropertyDefinitionsDeleteSchema = BaseSchema.extend({
  body: BaseIdSchema,
});

export type PropertyDefinitionsDeleteReq = z.infer<
  typeof PropertyDefinitionsDeleteSchema
>;
