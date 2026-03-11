"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const definition = await queryInterface.describeTable(
        "property_definitions",
        {
          transaction,
        }
      );

      if (definition.collectionId?.allowNull) {
        return;
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
        {
          transaction,
        }
      );
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const definition = await queryInterface.describeTable(
        "property_definitions",
        {
          transaction,
        }
      );

      if (!definition.collectionId?.allowNull) {
        return;
      }

      await queryInterface.changeColumn(
        "property_definitions",
        "collectionId",
        {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: "collections",
            key: "id",
          },
          onDelete: "CASCADE",
        },
        {
          transaction,
        }
      );
    });
  },
};
