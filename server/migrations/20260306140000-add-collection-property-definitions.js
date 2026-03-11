"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "collection_property_definitions",
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
          },
          collectionId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "collections",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          propertyDefinitionId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "property_definitions",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          state: {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: "attached",
          },
          required: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false,
          },
          inheritToChildren: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          index: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          teamId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "teams",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          createdById: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          lastModifiedById: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "CASCADE",
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          deletedAt: {
            type: Sequelize.DATE,
            allowNull: true,
          },
        },
        { transaction }
      );

      await Promise.all([
        queryInterface.addIndex(
          "collection_property_definitions",
          ["collectionId"],
          { transaction }
        ),
        queryInterface.addIndex(
          "collection_property_definitions",
          ["propertyDefinitionId"],
          { transaction }
        ),
        queryInterface.addIndex("collection_property_definitions", ["teamId"], {
          transaction,
        }),
      ]);

      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX collection_property_definitions_collection_definition_unique
         ON collection_property_definitions ("collectionId", "propertyDefinitionId")
         WHERE "deletedAt" IS NULL`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `INSERT INTO collection_property_definitions
           ("id", "collectionId", "propertyDefinitionId", "state", "required", "inheritToChildren", "index",
            "teamId", "createdById", "lastModifiedById", "createdAt", "updatedAt", "deletedAt")
         SELECT gen_random_uuid(),
                pd."collectionId",
                pd.id,
                'attached',
                pd.required,
                TRUE,
                lpad(
                  row_number() OVER (
                    PARTITION BY pd."collectionId"
                    ORDER BY pd."createdAt" ASC, pd.id ASC
                  )::text,
                  10,
                  '0'
                ),
                pd."teamId",
                pd."createdById",
                pd."lastModifiedById",
                pd."createdAt",
                pd."updatedAt",
                NULL
         FROM property_definitions AS pd
         WHERE pd."collectionId" IS NOT NULL
           AND pd."deletedAt" IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM collection_property_definitions AS cpd
             WHERE cpd."collectionId" = pd."collectionId"
               AND cpd."propertyDefinitionId" = pd.id
               AND cpd."deletedAt" IS NULL
           )`,
        { transaction }
      );

      const missingBackfillRows = await queryInterface.sequelize.query(
        `SELECT COUNT(*)::int AS count
         FROM property_definitions AS pd
         WHERE pd."collectionId" IS NOT NULL
           AND pd."deletedAt" IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM collection_property_definitions AS cpd
             WHERE cpd."collectionId" = pd."collectionId"
               AND cpd."propertyDefinitionId" = pd.id
               AND cpd."deletedAt" IS NULL
           )`,
        {
          transaction,
          type: Sequelize.QueryTypes.SELECT,
        }
      );

      if ((missingBackfillRows[0]?.count ?? 0) > 0) {
        throw new Error(
          "Failed to backfill collection_property_definitions for all active collection property definitions."
        );
      }

      await queryInterface.changeColumn(
        "property_definitions",
        "collectionId",
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: "collections",
            key: "id",
          },
          onDelete: "CASCADE",
        },
        { transaction }
      );

      await queryInterface.sequelize.query(
        `DROP INDEX IF EXISTS property_definitions_collection_name_type_unique`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `CREATE INDEX property_definitions_team_name_type_lookup
         ON property_definitions ("teamId", type, lower(btrim(name)))
         WHERE "deletedAt" IS NULL`,
        { transaction }
      );
    });
  },

  async down() {
    throw new Error(
      "Irreversible migration: collection_property_definitions replaces collection-owned property definitions."
    );
  },
};
