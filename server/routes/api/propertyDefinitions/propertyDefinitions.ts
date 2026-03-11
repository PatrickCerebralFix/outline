import Router from "koa-router";
import { NotFoundError, ValidationError } from "@server/errors";
import auth from "@server/middlewares/authentication";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import {
  CollectionPropertyDefinition,
  DocumentProperty,
  PropertyDefinition,
  PropertyDefinitionOption,
  User,
} from "@server/models";
import { authorize, can } from "@server/policies";
import { presentPolicies, presentPropertyDefinition } from "@server/presenters";
import ReconcileDocumentPropertyOptionsTask from "@server/queues/tasks/ReconcileDocumentPropertyOptionsTask";
import { sequelize } from "@server/storage/database";
import type { APIContext } from "@server/types";
import { resolveEffectivePropertyDefinitionIdsForCollections } from "@server/utils/collectionPropertyDefinitions";
import {
  CollectionPropertyDefinitionState,
  DocumentPropertyType,
} from "@shared/types";
import { QueryTypes, UniqueConstraintError } from "sequelize";
import * as T from "./schema";

const router = new Router();

function definitionIncludes() {
  return [
    {
      association: "options",
      required: false,
    },
  ];
}

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
  options: T.PropertyDefinitionsCreateReq["body"]["options"]
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

async function listDefinitionsForAccessibleCollections(user: User) {
  const collectionIds = await user.collectionIds();

  if (collectionIds.length === 0) {
    return [];
  }

  const definitionIdsByCollectionId =
    await resolveEffectivePropertyDefinitionIdsForCollections(
      collectionIds,
      user.teamId
    );
  const definitionIds = Array.from(
    new Set(
      Array.from(definitionIdsByCollectionId.values()).flatMap((ids) =>
        Array.from(ids)
      )
    )
  );

  if (definitionIds.length === 0) {
    return [];
  }

  return PropertyDefinition.findAll({
    where: {
      id: definitionIds,
      teamId: user.teamId,
      deletedAt: null,
    },
    include: definitionIncludes(),
    order: [["name", "ASC"]],
  });
}

async function listDefinitionUsageCounts(teamId: string) {
  const rows = await sequelize.query<{
    propertyDefinitionId: string;
    count: number;
  }>(
    `SELECT "propertyDefinitionId", COUNT(*)::int AS "count"
     FROM collection_property_definitions
     WHERE "teamId" = :teamId
       AND "deletedAt" IS NULL
       AND state = :state
     GROUP BY "propertyDefinitionId"`,
    {
      replacements: {
        teamId,
        state: CollectionPropertyDefinitionState.Attached,
      },
      type: QueryTypes.SELECT,
    }
  );

  return new Map(rows.map((row) => [row.propertyDefinitionId, row.count]));
}

router.post(
  "propertyDefinitions.list",
  auth(),
  validate(T.PropertyDefinitionsListSchema),
  async (ctx: APIContext<T.PropertyDefinitionsListReq>) => {
    const { user } = ctx.state.auth;

    const definitions = await (user.isAdmin
      ? PropertyDefinition.findAll({
          where: {
            teamId: user.teamId,
            deletedAt: null,
          },
          include: definitionIncludes(),
          order: [["name", "ASC"]],
        })
      : listDefinitionsForAccessibleCollections(user));
    const usageCounts = user.isAdmin
      ? await listDefinitionUsageCounts(user.teamId)
      : new Map<string, number>();

    ctx.body = {
      data: definitions.map((definition) =>
        presentPropertyDefinition(definition, {
          usageCount: usageCounts.get(definition.id) ?? 0,
        })
      ),
      policies: presentPolicies(user, definitions),
    };
  }
);

router.post(
  "propertyDefinitions.create",
  auth(),
  validate(T.PropertyDefinitionsCreateSchema),
  transaction(),
  async (ctx: APIContext<T.PropertyDefinitionsCreateReq>) => {
    const { name, description, type, options } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    authorize(user, "update", user.team);
    assertOptionsSupported(type, options.length > 0);

    let definition: PropertyDefinition;
    try {
      definition = await PropertyDefinition.createWithCtx(ctx, {
        teamId: user.teamId,
        name: normalizeDefinitionName(name),
        description: description ?? null,
        type,
        createdById: user.id,
        lastModifiedById: user.id,
      });
    } catch (error) {
      rethrowDuplicateDefinitionError(error);
    }

    if (options.length > 0) {
      await syncDefinitionOptions(ctx, definition, options);
    }

    const reloaded = await PropertyDefinition.findOne({
      where: {
        id: definition.id,
      },
      transaction,
      include: definitionIncludes(),
    });

    if (!reloaded) {
      throw NotFoundError();
    }

    ctx.body = {
      data: presentPropertyDefinition(reloaded),
      policies: presentPolicies(user, [reloaded]),
    };
  }
);

router.post(
  "propertyDefinitions.update",
  auth(),
  validate(T.PropertyDefinitionsUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.PropertyDefinitionsUpdateReq>) => {
    const { id, name, description, options } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const definition = await PropertyDefinition.findOne({
      where: {
        id,
        teamId: user.teamId,
      },
      transaction,
      include: definitionIncludes(),
    });

    if (!definition) {
      throw NotFoundError();
    }
    authorize(user, "update", definition);

    if (name !== undefined) {
      definition.name = normalizeDefinitionName(name);
    }

    if (description !== undefined) {
      definition.description = description ?? null;
    }

    if (name !== undefined || description !== undefined) {
      definition.lastModifiedById = user.id;
      try {
        await definition.saveWithCtx(ctx);
      } catch (error) {
        rethrowDuplicateDefinitionError(error);
      }
    }

    if (options !== undefined) {
      assertOptionsSupported(definition.type, options.length > 0);
      await syncDefinitionOptions(ctx, definition, options);
    }

    const reloaded = await PropertyDefinition.findOne({
      where: {
        id: definition.id,
      },
      transaction,
      include: definitionIncludes(),
    });

    if (!reloaded) {
      throw NotFoundError();
    }

    if (options !== undefined) {
      transaction.afterCommit(() => {
        void new ReconcileDocumentPropertyOptionsTask().schedule({
          propertyDefinitionId: reloaded.id,
          userId: user.id,
        });
      });
    }

    ctx.body = {
      data: presentPropertyDefinition(reloaded),
      policies: presentPolicies(user, [reloaded]),
    };
  }
);

router.post(
  "propertyDefinitions.delete",
  auth(),
  validate(T.PropertyDefinitionsDeleteSchema),
  transaction(),
  async (ctx: APIContext<T.PropertyDefinitionsDeleteReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const definition = await PropertyDefinition.findOne({
      where: {
        id,
        teamId: user.teamId,
      },
      transaction,
      include: definitionIncludes(),
    });

    if (!definition) {
      throw NotFoundError();
    }
    authorize(user, "delete", definition);

    await definition.destroyWithCtx(ctx);

    await PropertyDefinitionOption.destroy({
      where: {
        propertyDefinitionId: definition.id,
      },
      transaction,
    });
    await CollectionPropertyDefinition.destroy({
      where: {
        propertyDefinitionId: definition.id,
      },
      transaction,
    });
    await DocumentProperty.destroy({
      where: {
        propertyDefinitionId: definition.id,
      },
      transaction,
    });

    await sequelize.query(
      `UPDATE documents
       SET properties = COALESCE(properties, '{}'::jsonb) - :propertyDefinitionId
       WHERE COALESCE(properties, '{}'::jsonb) ? :propertyDefinitionId`,
      {
        replacements: {
          propertyDefinitionId: definition.id,
        },
        transaction,
      }
    );

    ctx.body = {
      success: true,
    };
  }
);

export default router;
