module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await Promise.all([
        queryInterface.sequelize.query(
          `UPDATE documents
           SET properties = (
             SELECT COALESCE(
               jsonb_object_agg(
                 entry.key,
                 CASE
                   WHEN jsonb_typeof(entry.value) = 'object' AND entry.value ? 'value'
                     THEN entry.value -> 'value'
                   ELSE entry.value
                 END
               ),
               '{}'::jsonb
             )
             FROM jsonb_each(COALESCE(documents.properties, '{}'::jsonb)) AS entry(key, value)
           )`,
          { transaction }
        ),
        queryInterface.sequelize.query(
          `UPDATE revisions
           SET properties = (
             SELECT COALESCE(
               jsonb_object_agg(
                 entry.key,
                 CASE
                   WHEN jsonb_typeof(entry.value) = 'object' AND entry.value ? 'value'
                     THEN entry.value -> 'value'
                   ELSE entry.value
                 END
               ),
               '{}'::jsonb
             )
             FROM jsonb_each(COALESCE(revisions.properties, '{}'::jsonb)) AS entry(key, value)
           )`,
          { transaction }
        ),
      ]);

      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX property_definitions_collection_name_type_unique
         ON property_definitions ("collectionId", lower(btrim(name)), type)
         WHERE "deletedAt" IS NULL`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    void queryInterface;
    throw new Error(
      "This migration is irreversible because flattened property snapshots replace the legacy object-wrapped format."
    );
  },
};
