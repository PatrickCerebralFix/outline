"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const searchDocument = `
    CREATE OR REPLACE FUNCTION documents_search_trigger() RETURNS trigger AS $$
    begin
      new."searchVector" :=
        setweight(to_tsvector('english', coalesce(new.title, '')),'A') ||
        setweight(to_tsvector('english', coalesce(array_to_string(new."previousTitles", ' , '),'')),'C') ||
        setweight(to_tsvector('english', substring(coalesce(new.text, ''), 1, 1000000)), 'D') ||
        setweight(to_tsvector('english', substring(coalesce(new.properties::text, ''), 1, 1000000)), 'D');
      return new;
    end
    $$ LANGUAGE plpgsql;
        `;
    await queryInterface.sequelize.query(searchDocument);
  },

  async down(queryInterface) {
    const searchDocument = `
    CREATE OR REPLACE FUNCTION documents_search_trigger() RETURNS trigger AS $$
    begin
      new."searchVector" :=
        setweight(to_tsvector('english', coalesce(new.title, '')),'A') ||
        setweight(to_tsvector('english', coalesce(array_to_string(new."previousTitles", ' , '),'')),'C') ||
        setweight(to_tsvector('english', substring(coalesce(new.text, ''), 1, 1000000)), 'D');
      return new;
    end
    $$ LANGUAGE plpgsql;
        `;
    await queryInterface.sequelize.query(searchDocument);
  },
};
