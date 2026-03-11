import Router from "koa-router";
import {
  CollectionPropertyDefinitionState,
  DocumentPropertyType,
} from "@shared/types";
import { NotFoundError, ValidationError } from "@server/errors";
import auth from "@server/middlewares/authentication";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import {
  Collection,
  PropertyDefinition,
  PropertyDefinitionOption,
} from "@server/models";
import { authorize, can } from "@server/policies";
import { presentPropertyDefinition } from "@server/presenters";
import type { APIContext } from "@server/types";
import { UniqueConstraintError } from "sequelize";
import {
  attachPropertyDefinitionsToCollection,
  listWorkspaceCollectionPropertySummaries,
  resolveEffectivePropertyDefinitionIdsForCollections,
  resolveCollectionPropertyDefinitions,
  type ResolvedCollectionPropertyDefinition,
  saveCollectionPropertyDefinitions,
} from "@server/utils/collectionPropertyDefinitions";
import * as T from "./schema";

const router = new Router();

function assertOptionsSupported(
  type: DocumentPropertyType,
  hasOptions: boolean
) {
  const supportsOptions =
    type === DocumentPropertyType.Select ||
    type === DocumentPropertyType.MultiSelect;

  if (!supportsOptions && hasOptions) {
    throw ValidationError(`Property type "${type}" does not support options`);
  }
}

function normalizeDefinitionName(name: string) {
  return name.trim();
}

function rethrowDuplicateDefinitionError(error: unknown): never {
  if (error instanceof UniqueConstraintError) {
    throw ValidationError("A property with this name and type already exists");
  }

  throw error;
}

async function syncDefinitionOptions(
  ctx: APIContext,
  definition: PropertyDefinition,
  options: Array<{
    id?: string;
    label: string;
    value: string;
    color?: string | null;
    index?: string | null;
  }>
) {
  const { user } = ctx.state.auth;
  const { transaction } = ctx.state;
  const existing = await PropertyDefinitionOption.findAll({
    where: {
      propertyDefinitionId: definition.id,
    },
    transaction,
  });
  const existingById = new Map(existing.map((option) => [option.id, option]));
  const keepIds: string[] = [];

  let position = 0;
  for (const option of options) {
    const index = option.index ?? `${position++}`;

    if (option.id) {
      const existingOption = existingById.get(option.id);

      if (!existingOption) {
        throw ValidationError("One or more property option IDs are invalid");
      }

      existingOption.label = option.label;
      existingOption.value = option.value;
      existingOption.color = option.color ?? null;
      existingOption.index = index;
      existingOption.lastModifiedById = user.id;
      await existingOption.save({ transaction });
      keepIds.push(existingOption.id);
      continue;
    }

    const created = await PropertyDefinitionOption.create(
      {
        label: option.label,
        value: option.value,
        color: option.color ?? null,
        index,
        propertyDefinitionId: definition.id,
        teamId: definition.teamId,
        createdById: user.id,
        lastModifiedById: user.id,
      },
      {
        transaction,
      }
    );
    keepIds.push(created.id);
  }

  const deleteIds = existing
    .filter((option) => !keepIds.includes(option.id))
    .map((option) => option.id);

  if (deleteIds.length > 0) {
    await PropertyDefinitionOption.destroy({
      where: {
        id: deleteIds,
        propertyDefinitionId: definition.id,
      },
      transaction,
    });
  }
}

async function createPropertyDefinition(
  ctx: APIContext,
  input: {
    name: string;
    description?: string | null;
    type: DocumentPropertyType;
    options: Array<{
      id?: string;
      label: string;
      value: string;
      color?: string | null;
      index?: string | null;
    }>;
  }
) {
  const { user } = ctx.state.auth;

  assertOptionsSupported(input.type, input.options.length > 0);

  let definition: PropertyDefinition;
  try {
    definition = await PropertyDefinition.createWithCtx(ctx, {
      teamId: user.teamId,
      name: normalizeDefinitionName(input.name),
      description: input.description ?? null,
      type: input.type,
      createdById: user.id,
      lastModifiedById: user.id,
    });
  } catch (error) {
    rethrowDuplicateDefinitionError(error);
  }

  if (input.options.length > 0) {
    await syncDefinitionOptions(ctx, definition, input.options);
  }

  const reloaded = await PropertyDefinition.findOne({
    where: {
      id: definition.id,
      teamId: user.teamId,
    },
    transaction: ctx.state.transaction,
    include: [
      {
        association: "options",
        required: false,
      },
    ],
  });

  if (!reloaded) {
    throw NotFoundError();
  }

  return reloaded;
}

function presentResolvedCollectionPropertyDefinition(
  row: ResolvedCollectionPropertyDefinition
) {
  return {
    id: row.id,
    collectionId: row.collectionId,
    propertyDefinitionId: row.propertyDefinitionId,
    sourceCollectionId: row.sourceCollectionId,
    sourceCollectionName: row.sourceCollectionName,
    state: row.state,
    required: row.required,
    inheritToChildren: row.inheritToChildren,
    index: row.index,
    isInherited: row.isInherited,
    isCustomized: row.isCustomized,
    isOverwritten: row.isOverwritten,
    shadowed: row.shadowed,
    definition: presentPropertyDefinition(row.definition),
  };
}

router.post(
  "collectionPropertyDefinitions.workspaceList",
  auth(),
  validate(T.CollectionPropertyDefinitionsWorkspaceListSchema),
  async (ctx: APIContext<T.CollectionPropertyDefinitionsWorkspaceListReq>) => {
    const { user } = ctx.state.auth;
    authorize(user, "update", user.team);

    ctx.body = {
      data: await listWorkspaceCollectionPropertySummaries(user.teamId),
    };
  }
);

router.post(
  "collectionPropertyDefinitions.list",
  auth(),
  validate(T.CollectionPropertyDefinitionsListSchema),
  async (ctx: APIContext<T.CollectionPropertyDefinitionsListReq>) => {
    const { collectionId, includeAvailable, includeHidden, includeLocal } =
      ctx.input.body;
    const { user } = ctx.state.auth;
    const collection = await Collection.findByPk(collectionId, {
      userId: user.id,
      rejectOnEmpty: true,
    });
    authorize(user, "readDocument", collection);

    const resolved = await resolveCollectionPropertyDefinitions(
      collection.id,
      user.teamId
    );
    const canUpdateCollection = !!can(user, "update", collection);
    const unavailableDefinitionIds = new Set(
      [...resolved.effective, ...resolved.hidden].map(
        (row) => row.propertyDefinitionId
      )
    );
    let available: PropertyDefinition[] = [];

    if (includeAvailable && canUpdateCollection) {
      if (user.isAdmin) {
        available = await PropertyDefinition.findAll({
          where: {
            teamId: user.teamId,
            deletedAt: null,
          },
          include: [
            {
              association: "options",
              required: false,
            },
          ],
          order: [["name", "ASC"]],
        });
      } else {
        const collectionIds = await user.collectionIds();
        const definitionIdsByCollectionId =
          await resolveEffectivePropertyDefinitionIdsForCollections(
            collectionIds,
            user.teamId
          );
        const definitionIds = Array.from(
          new Set(
            Array.from(definitionIdsByCollectionId.values()).flatMap(
              (ids) => Array.from(ids)
            )
          )
        );

        available =
          definitionIds.length > 0
            ? await PropertyDefinition.findAll({
                where: {
                  id: definitionIds,
                  teamId: user.teamId,
                  deletedAt: null,
                },
                include: [
                  {
                    association: "options",
                    required: false,
                  },
                ],
                order: [["name", "ASC"]],
              })
            : [];
      }
    }

    ctx.body = {
      data: {
        effective: resolved.effective.map(
          presentResolvedCollectionPropertyDefinition
        ),
        hidden: includeHidden
          ? resolved.hidden.map(presentResolvedCollectionPropertyDefinition)
          : [],
        local: includeLocal
          ? resolved.local.map(presentResolvedCollectionPropertyDefinition)
          : [],
        available: includeAvailable
          ? available
              .filter((definition) => !unavailableDefinitionIds.has(definition.id))
              .map((definition) => presentPropertyDefinition(definition))
          : [],
      },
    };
  }
);

router.post(
  "collectionPropertyDefinitions.save",
  auth(),
  validate(T.CollectionPropertyDefinitionsSaveSchema),
  transaction(),
  async (ctx: APIContext<T.CollectionPropertyDefinitionsSaveReq>) => {
    const { collectionId, rows, replaceLocal, definitions } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    const collection = await Collection.findByPk(collectionId, {
      userId: user.id,
      transaction,
      rejectOnEmpty: true,
    });
    authorize(user, "update", collection);

    const createdDefinitionIdsByTempId = new Map<string, string>();

    for (const definition of definitions) {
      const createdDefinition = await createPropertyDefinition(ctx, definition);
      createdDefinitionIdsByTempId.set(definition.tempId, createdDefinition.id);
    }

    const resolvedRows = rows.map((row) => ({
      ...row,
      propertyDefinitionId:
        createdDefinitionIdsByTempId.get(row.propertyDefinitionId) ??
        row.propertyDefinitionId,
    }));

    await saveCollectionPropertyDefinitions({
      collectionId: collection.id,
      teamId: user.teamId,
      userId: user.id,
      rows: resolvedRows.map((row) => ({
        propertyDefinitionId: row.propertyDefinitionId,
        state: row.state as CollectionPropertyDefinitionState,
        required: row.required,
        inheritToChildren: row.inheritToChildren,
        index: row.index ?? null,
      })),
      transaction,
      replaceLocal,
    });

    const resolved = await resolveCollectionPropertyDefinitions(
      collection.id,
      user.teamId,
      transaction
    );

    ctx.body = {
      data: {
        effective: resolved.effective.map(
          presentResolvedCollectionPropertyDefinition
        ),
        hidden: resolved.hidden.map(
          presentResolvedCollectionPropertyDefinition
        ),
        local: resolved.local.map(presentResolvedCollectionPropertyDefinition),
      },
    };
  }
);

router.post(
  "collectionPropertyDefinitions.create",
  auth(),
  validate(T.CollectionPropertyDefinitionsCreateSchema),
  transaction(),
  async (ctx: APIContext<T.CollectionPropertyDefinitionsCreateReq>) => {
    const { collectionId, name, description, type, options } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    const collection = await Collection.findByPk(collectionId, {
      userId: user.id,
      transaction,
      rejectOnEmpty: true,
    });
    authorize(user, "update", collection);

    const definition = await createPropertyDefinition(ctx, {
      name,
      description,
      type,
      options,
    });

    await attachPropertyDefinitionsToCollection({
      collectionId: collection.id,
      propertyDefinitionIds: [definition.id],
      teamId: user.teamId,
      userId: user.id,
      transaction,
    });

    ctx.body = {
      data: presentPropertyDefinition(definition),
    };
  }
);

export default router;
