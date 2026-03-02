"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "property_definitions",
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
          },
          name: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          description: {
            type: Sequelize.TEXT,
            allowNull: true,
          },
          type: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          required: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false,
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
        {
          transaction,
        }
      );

      await queryInterface.createTable(
        "property_definition_options",
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
          },
          label: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          value: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          color: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          index: {
            type: Sequelize.STRING,
            allowNull: true,
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
        {
          transaction,
        }
      );

      await queryInterface.createTable(
        "document_properties",
        {
          id: {
            type: Sequelize.UUID,
            primaryKey: true,
            allowNull: false,
          },
          documentId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "documents",
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
          value: {
            type: Sequelize.JSONB,
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
        },
        {
          transaction,
        }
      );

      await queryInterface.addColumn(
        "documents",
        "properties",
        {
          type: Sequelize.JSONB,
          allowNull: false,
          defaultValue: {},
        },
        {
          transaction,
        }
      );

      await queryInterface.addColumn(
        "revisions",
        "properties",
        {
          type: Sequelize.JSONB,
          allowNull: false,
          defaultValue: {},
        },
        {
          transaction,
        }
      );

      await Promise.all([
        queryInterface.addIndex("property_definitions", ["teamId"], {
          transaction,
        }),
        queryInterface.addIndex("property_definitions", ["collectionId"], {
          transaction,
        }),
        queryInterface.addIndex("property_definitions", ["createdById"], {
          transaction,
        }),
        queryInterface.addIndex("property_definitions", ["lastModifiedById"], {
          transaction,
        }),
        queryInterface.addIndex(
          "property_definition_options",
          ["propertyDefinitionId"],
          {
            transaction,
          }
        ),
        queryInterface.addIndex("property_definition_options", ["teamId"], {
          transaction,
        }),
        queryInterface.addIndex("document_properties", ["documentId"], {
          transaction,
        }),
        queryInterface.addIndex("document_properties", ["propertyDefinitionId"], {
          transaction,
        }),
        queryInterface.addIndex("document_properties", ["teamId"], {
          transaction,
        }),
        queryInterface.addIndex(
          "document_properties",
          ["documentId", "propertyDefinitionId"],
          {
            unique: true,
            transaction,
          }
        ),
      ]);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn("revisions", "properties", {
        transaction,
      });
      await queryInterface.removeColumn("documents", "properties", {
        transaction,
      });
      await queryInterface.dropTable("document_properties", { transaction });
      await queryInterface.dropTable("property_definition_options", {
        transaction,
      });
      await queryInterface.dropTable("property_definitions", { transaction });
    });
  },
};
