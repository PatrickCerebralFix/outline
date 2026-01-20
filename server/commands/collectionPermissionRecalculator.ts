import { Op, type Transaction } from "sequelize";
import { traceFunction } from "@server/logging/tracing";
import {
  Collection,
  UserMembership,
  GroupMembership,
} from "@server/models";

type Props = {
  /** The collection that was moved or whose permissions need recalculation. */
  collection: Collection;
  /** The transaction to use for all database operations. */
  transaction?: Transaction;
};

/**
 * Recalculates inherited permissions for a collection and all its descendants.
 * This is called when a collection is moved to a new parent or when permissions
 * on an ancestor change.
 *
 * @param props The collection and transaction.
 */
async function collectionPermissionRecalculator({
  collection,
  transaction,
}: Props): Promise<void> {
  // Get all ancestor collection IDs (from immediate parent to root)
  const ancestorIds = await getAncestorIds(collection, transaction);

  // Get all descendant collection IDs
  const descendantIds = await collection.findAllChildCollectionIds({
    transaction,
  });

  // For each descendant (including the collection itself), recalculate inherited permissions
  const collectionsToUpdate = [collection.id, ...descendantIds];

  for (const collectionId of collectionsToUpdate) {
    await recalculatePermissionsForCollection(
      collectionId,
      ancestorIds,
      transaction
    );
  }
}

/**
 * Get all ancestor collection IDs for a collection, ordered from immediate parent to root.
 */
async function getAncestorIds(
  collection: Collection,
  transaction?: Transaction
): Promise<string[]> {
  const ancestors: string[] = [];
  let currentParentId = collection.parentCollectionId;

  while (currentParentId) {
    ancestors.push(currentParentId);
    const parent = await Collection.findByPk(currentParentId, {
      attributes: ["id", "parentCollectionId"],
      transaction,
    });
    if (!parent) {
      break;
    }
    currentParentId = parent.parentCollectionId;
  }

  return ancestors;
}

/**
 * Recalculate inherited permissions for a single collection based on its ancestors.
 */
async function recalculatePermissionsForCollection(
  collectionId: string,
  ancestorIds: string[],
  transaction?: Transaction
): Promise<void> {
  // Remove all inherited (sourced) user memberships for this collection
  await UserMembership.destroy({
    where: {
      collectionId,
      sourceId: { [Op.ne]: null },
    },
    transaction,
    hooks: false,
  });

  // Remove all inherited (sourced) group memberships for this collection
  await GroupMembership.destroy({
    where: {
      collectionId,
      sourceId: { [Op.ne]: null },
    },
    transaction,
    hooks: false,
  });

  // For each ancestor (starting from closest parent), copy permissions that should inherit
  for (const ancestorId of ancestorIds) {
    // Get explicit user memberships on the ancestor
    const userMemberships = await UserMembership.findAll({
      where: {
        collectionId: ancestorId,
        sourceId: null, // Only explicit memberships
      },
      transaction,
    });

    for (const membership of userMemberships) {
      // Check if explicit membership already exists on this collection
      const existing = await UserMembership.findOne({
        where: {
          collectionId,
          userId: membership.userId,
          sourceId: null,
        },
        transaction,
      });

      // Only create inherited membership if no explicit override exists
      if (!existing) {
        // Check if we already inherited this membership from a closer ancestor
        const alreadyInherited = await UserMembership.findOne({
          where: {
            collectionId,
            userId: membership.userId,
          },
          transaction,
        });

        if (!alreadyInherited) {
          await UserMembership.create(
            {
              collectionId,
              userId: membership.userId,
              permission: membership.permission,
              sourceId: membership.id,
              createdById: membership.createdById,
            },
            { transaction, hooks: false }
          );
        }
      }
    }

    // Get explicit group memberships on the ancestor
    const groupMemberships = await GroupMembership.findAll({
      where: {
        collectionId: ancestorId,
        sourceId: null,
      },
      transaction,
    });

    for (const membership of groupMemberships) {
      // Check if explicit membership already exists on this collection
      const existing = await GroupMembership.findOne({
        where: {
          collectionId,
          groupId: membership.groupId,
          sourceId: null,
        },
        transaction,
      });

      // Only create inherited membership if no explicit override exists
      if (!existing) {
        // Check if we already inherited this membership from a closer ancestor
        const alreadyInherited = await GroupMembership.findOne({
          where: {
            collectionId,
            groupId: membership.groupId,
          },
          transaction,
        });

        if (!alreadyInherited) {
          await GroupMembership.create(
            {
              collectionId,
              groupId: membership.groupId,
              permission: membership.permission,
              sourceId: membership.id,
              createdById: membership.createdById,
            },
            { transaction, hooks: false }
          );
        }
      }
    }
  }
}

export default traceFunction({
  spanName: "collectionPermissionRecalculator",
})(collectionPermissionRecalculator);
