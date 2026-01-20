import fractionalIndex from "fractional-index";
import { Op, Sequelize, type FindOptions } from "sequelize";
import Collection from "@server/models/Collection";

interface RemoveIndexCollisionOptions extends FindOptions {
  parentCollectionId?: string | null;
}

/**
 * Checks for and resolves index collisions within a team's collections.
 *
 * @param teamId The team id whose collections has to be fetched
 * @param index the index for which collision has to be checked
 * @param options Additional options to be passed to the query
 * @param options.parentCollectionId Optional parent collection ID to scope the collision check to siblings
 * @returns An index, if there is collision returns a new index otherwise the same index
 */
export default async function removeIndexCollision(
  teamId: string,
  index: string,
  options: RemoveIndexCollisionOptions = {}
) {
  const { parentCollectionId, ...findOptions } = options;

  // Build the where clause to filter by parent (siblings only)
  const parentWhere =
    parentCollectionId === undefined
      ? {}
      : { parentCollectionId: parentCollectionId ?? { [Op.is]: null } };

  const collection = await Collection.findOne({
    where: {
      teamId,
      deletedAt: null,
      index,
      ...parentWhere,
    },
    ...findOptions,
  });

  if (!collection) {
    return index;
  }

  const nextCollection = await Collection.findAll({
    where: {
      teamId,
      deletedAt: null,
      index: Sequelize.literal(`"collection"."index" collate "C" > :index`),
      ...parentWhere,
    },
    attributes: ["id", "index"],
    limit: 1,
    order: [
      Sequelize.literal('"collection"."index" collate "C"'),
      ["updatedAt", "DESC"],
    ],
    replacements: { index },
    ...findOptions,
  });
  const nextCollectionIndex = nextCollection.length
    ? nextCollection[0].index
    : null;
  return fractionalIndex(index, nextCollectionIndex);
}
