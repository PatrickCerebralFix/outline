"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const definition = await queryInterface.describeTable(
        "collection_property_definitions",
        {
          transaction,
        }
      );

      if (definition.inheritToChildren) {
        return;
      }

      await queryInterface.addColumn(
        "collection_property_definitions",
        "inheritToChildren",
        {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        {
          transaction,
        }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const definition = await queryInterface.describeTable(
        "collection_property_definitions",
        {
          transaction,
        }
      );

      if (!definition.inheritToChildren) {
        return;
      }

      await queryInterface.removeColumn(
        "collection_property_definitions",
        "inheritToChildren",
        {
          transaction,
        }
      );
    });
  },
};
