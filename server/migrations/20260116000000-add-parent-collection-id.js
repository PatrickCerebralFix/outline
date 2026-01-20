"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Add parentCollectionId column with self-referencing foreign key
      await queryInterface.addColumn(
        "collections",
        "parentCollectionId",
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: "collections",
            key: "id",
          },
          onDelete: "RESTRICT", // Prevent deletion of parent with children
        },
        { transaction }
      );

      // Add index for faster lookups of children by parent
      await queryInterface.addIndex(
        "collections",
        ["parentCollectionId"],
        { transaction }
      );

      // Add composite index for team + parent queries (listing children within a team)
      await queryInterface.addIndex(
        "collections",
        ["teamId", "parentCollectionId"],
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex(
        "collections",
        ["teamId", "parentCollectionId"],
        { transaction }
      );
      await queryInterface.removeIndex(
        "collections",
        ["parentCollectionId"],
        { transaction }
      );
      await queryInterface.removeColumn("collections", "parentCollectionId", {
        transaction,
      });
    });
  },
};
