"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addIndex("documents", ["properties"], {
        name: "documents_properties_gin_idx",
        using: "gin",
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex(
        "documents",
        "documents_properties_gin_idx",
        {
          transaction,
        }
      );
    });
  },
};
