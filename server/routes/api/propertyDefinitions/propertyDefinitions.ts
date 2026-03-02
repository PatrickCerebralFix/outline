import Router from "koa-router";
import { DocumentPropertyType } from "@shared/types";
import { syncDocumentPropertiesForDefinition } from "@server/commands/documentPropertyUpdater";
import { NotFoundError, ValidationError } from "@server/errors";
import auth from "@server/middlewares/authentication";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import {
  Collection,
  DocumentProperty,
  PropertyDefinition,
  PropertyDefinitionOption,
} from "@server/models";
import { authorize } from "@server/policies";
import { presentPolicies, presentPropertyDefinition } from "@server/presenters";
import { sequelize } from "@server/storage/database";
import type { APIContext } from "@server/types";
import * as T from "./schema";

const router = new Router();

function definitionIncludes(userId: string) {
  return [
    {
      model: Collection.scope([
        "defaultScope",
        {
          method: ["withMembership", userId],
        },
      ]),
      as: "collection",
      required: true,
    },
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

router.post(
  "propertyDefinitions.list",
  auth(),
  validate(T.PropertyDefinitionsListSchema),
  async (ctx: APIContext<T.PropertyDefinitionsListReq>) => {
    const { user } = ctx.state.auth;
    const { collectionId } = ctx.input.body;

    let definitions: PropertyDefinition[] = [];

    if (collectionId) {
      const collection = await Collection.findByPk(collectionId, {
        userId: user.id,
        rejectOnEmpty: true,
      });
      authorize(user, "readDocument", collection);

      definitions = await PropertyDefinition.findAll({
        where: {
          collectionId,
          teamId: user.teamId,
        },
        include: definitionIncludes(user.id),
        order: [
          ["createdAt", "ASC"],
          [{ model: PropertyDefinitionOption, as: "options" }, "index", "ASC"],
          [
            { model: PropertyDefinitionOption, as: "options" },
            "createdAt",
            "ASC",
          ],
        ],
      });
    } else {
      const collectionIds = await user.collectionIds();

      if (collectionIds.length > 0) {
        definitions = await PropertyDefinition.findAll({
          where: {
            collectionId: collectionIds,
            teamId: user.teamId,
          },
          include: definitionIncludes(user.id),
          order: [
            ["createdAt", "ASC"],
            [
              { model: PropertyDefinitionOption, as: "options" },
              "index",
              "ASC",
            ],
            [
              { model: PropertyDefinitionOption, as: "options" },
              "createdAt",
              "ASC",
            ],
          ],
        });
      }
    }

    ctx.body = {
      data: definitions.map((definition) =>
        presentPropertyDefinition(definition)
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
    const { collectionId, name, description, type, required, options } =
      ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const collection = await Collection.findByPk(collectionId, {
      userId: user.id,
      rejectOnEmpty: true,
      transaction,
    });
    authorize(user, "createPropertyDefinition", collection);

    assertOptionsSupported(type, options.length > 0);

    const definition = await PropertyDefinition.createWithCtx(ctx, {
      collectionId,
      teamId: user.teamId,
      name,
      description: description ?? null,
      type,
      required,
      createdById: user.id,
      lastModifiedById: user.id,
    });

    if (options.length > 0) {
      await syncDefinitionOptions(ctx, definition, options);
    }

    const reloaded = await PropertyDefinition.findOne({
      where: {
        id: definition.id,
      },
      transaction,
      include: definitionIncludes(user.id),
      order: [
        [{ model: PropertyDefinitionOption, as: "options" }, "index", "ASC"],
        [
          { model: PropertyDefinitionOption, as: "options" },
          "createdAt",
          "ASC",
        ],
      ],
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
    const { id, name, description, required, options } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const definition = await PropertyDefinition.findOne({
      where: {
        id,
        teamId: user.teamId,
      },
      transaction,
      include: definitionIncludes(user.id),
    });

    if (!definition) {
      throw NotFoundError();
    }
    authorize(user, "update", definition);

    if (name !== undefined) {
      definition.name = name;
    }

    if (description !== undefined) {
      definition.description = description ?? null;
    }

    if (required !== undefined) {
      definition.required = required;
    }

    if (
      name !== undefined ||
      description !== undefined ||
      required !== undefined
    ) {
      definition.lastModifiedById = user.id;
      await definition.saveWithCtx(ctx);
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
      include: definitionIncludes(user.id),
      order: [
        [{ model: PropertyDefinitionOption, as: "options" }, "index", "ASC"],
        [
          { model: PropertyDefinitionOption, as: "options" },
          "createdAt",
          "ASC",
        ],
      ],
    });

    if (!reloaded) {
      throw NotFoundError();
    }

    if (name !== undefined || options !== undefined) {
      await syncDocumentPropertiesForDefinition(ctx, reloaded);
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
      include: definitionIncludes(user.id),
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

    await DocumentProperty.destroy({
      where: {
        propertyDefinitionId: definition.id,
      },
      transaction,
    });

    await sequelize.query(
      `UPDATE documents
       SET properties = COALESCE(properties, '{}'::jsonb) - :propertyDefinitionId
       WHERE "collectionId" = :collectionId`,
      {
        replacements: {
          propertyDefinitionId: definition.id,
          collectionId: definition.collectionId,
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
