"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [rows] = await queryInterface.sequelize.query(
        `SELECT is_nullable
         FROM information_schema.columns
         WHERE table_name = 'property_definitions'
           AND column_name = 'collectionId'`,
        { transaction }
      );

      if (rows[0]?.is_nullable === "YES") {
        return;
      }

      await queryInterface.sequelize.query(
        `ALTER TABLE "property_definitions"
         ALTER COLUMN "collectionId" DROP NOT NULL`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [rows] = await queryInterface.sequelize.query(
        `SELECT is_nullable
         FROM information_schema.columns
         WHERE table_name = 'property_definitions'
           AND column_name = 'collectionId'`,
        { transaction }
      );

      if (rows[0]?.is_nullable === "NO") {
        return;
      }

      const [countRows] = await queryInterface.sequelize.query(
        `SELECT COUNT(*)::int AS count
         FROM "property_definitions"
         WHERE "collectionId" IS NULL`
      );

      if ((countRows[0]?.count ?? 0) > 0) {
        throw new Error(
          'Cannot restore NOT NULL on property_definitions.collectionId while null values exist'
        );
      }

      await queryInterface.sequelize.query(
        `ALTER TABLE "property_definitions"
         ALTER COLUMN "collectionId" SET NOT NULL`,
        { transaction }
      );
    });
  },
};
