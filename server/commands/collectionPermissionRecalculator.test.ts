import { CollectionPermission } from "@shared/types";
import { Collection, UserMembership, GroupMembership } from "@server/models";
import {
  buildUser,
  buildAdmin,
  buildGroup,
  buildCollection,
  buildTeam,
} from "@server/test/factories";
import collectionPermissionRecalculator from "./collectionPermissionRecalculator";

describe("collectionPermissionRecalculator", () => {
  describe("user membership inheritance", () => {
    it("should create inherited memberships from parent", async () => {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const user = await buildUser({ teamId: team.id });

      // Create parent collection with explicit user membership
      const parent = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null, // private collection
      });

      await UserMembership.create({
        userId: user.id,
        collectionId: parent.id,
        permission: CollectionPermission.ReadWrite,
        createdById: admin.id,
      });

      // Create child collection under parent
      const child = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
        parentCollectionId: parent.id,
      });

      // Run recalculator
      await collectionPermissionRecalculator({ collection: child });

      // Verify child has inherited membership
      const childMembership = await UserMembership.findOne({
        where: {
          userId: user.id,
          collectionId: child.id,
        },
      });

      expect(childMembership).toBeTruthy();
      expect(childMembership!.permission).toEqual(CollectionPermission.ReadWrite);
      expect(childMembership!.sourceId).toBeTruthy(); // inherited membership has sourceId
    });

    it("should remove inherited memberships when moved to root", async () => {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const user = await buildUser({ teamId: team.id });

      // Create parent with user membership
      const parent = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
      });

      const parentMembership = await UserMembership.create({
        userId: user.id,
        collectionId: parent.id,
        permission: CollectionPermission.ReadWrite,
        createdById: admin.id,
      });

      // Create child under parent with inherited membership
      const child = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
        parentCollectionId: parent.id,
      });

      await UserMembership.create({
        userId: user.id,
        collectionId: child.id,
        permission: CollectionPermission.ReadWrite,
        createdById: admin.id,
        sourceId: parentMembership.id,
      });

      // Move child to root
      child.parentCollectionId = null;
      await child.save();

      // Run recalculator
      await collectionPermissionRecalculator({ collection: child });

      // Verify inherited membership is removed
      const childMembership = await UserMembership.findOne({
        where: {
          userId: user.id,
          collectionId: child.id,
        },
      });

      expect(childMembership).toBeNull();
    });

    it("should preserve explicit overrides during recalculation", async () => {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const user = await buildUser({ teamId: team.id });

      // Create parent with Admin permission
      const parent = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
      });

      await UserMembership.create({
        userId: user.id,
        collectionId: parent.id,
        permission: CollectionPermission.Admin,
        createdById: admin.id,
      });

      // Create child with explicit ReadOnly override (sourceId = null)
      const child = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
        parentCollectionId: parent.id,
      });

      await UserMembership.create({
        userId: user.id,
        collectionId: child.id,
        permission: CollectionPermission.Read,
        createdById: admin.id,
        sourceId: null, // explicit override
      });

      // Run recalculator
      await collectionPermissionRecalculator({ collection: child });

      // Verify explicit override is preserved
      const childMembership = await UserMembership.findOne({
        where: {
          userId: user.id,
          collectionId: child.id,
        },
      });

      expect(childMembership).toBeTruthy();
      expect(childMembership!.permission).toEqual(CollectionPermission.Read);
      expect(childMembership!.sourceId).toBeNull(); // still explicit
    });

    it("should handle deep hierarchies (grandparent -> parent -> child)", async () => {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const user = await buildUser({ teamId: team.id });

      // Create three-level hierarchy
      const grandparent = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
      });

      await UserMembership.create({
        userId: user.id,
        collectionId: grandparent.id,
        permission: CollectionPermission.Admin,
        createdById: admin.id,
      });

      const parent = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
        parentCollectionId: grandparent.id,
      });

      const child = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
        parentCollectionId: parent.id,
      });

      // Run recalculator on child
      await collectionPermissionRecalculator({ collection: child });

      // Verify child has inherited membership from grandparent
      const childMembership = await UserMembership.findOne({
        where: {
          userId: user.id,
          collectionId: child.id,
        },
      });

      expect(childMembership).toBeTruthy();
      expect(childMembership!.permission).toEqual(CollectionPermission.Admin);
      expect(childMembership!.sourceId).toBeTruthy();
    });

    it("should inherit from closest ancestor when multiple exist", async () => {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const user = await buildUser({ teamId: team.id });

      // Grandparent has Admin permission
      const grandparent = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
      });

      await UserMembership.create({
        userId: user.id,
        collectionId: grandparent.id,
        permission: CollectionPermission.Admin,
        createdById: admin.id,
      });

      // Parent has ReadOnly permission (closer ancestor)
      const parent = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
        parentCollectionId: grandparent.id,
      });

      await UserMembership.create({
        userId: user.id,
        collectionId: parent.id,
        permission: CollectionPermission.Read,
        createdById: admin.id,
        sourceId: null, // explicit on parent
      });

      const child = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
        parentCollectionId: parent.id,
      });

      // Run recalculator
      await collectionPermissionRecalculator({ collection: child });

      // Child should inherit ReadOnly from parent (closest ancestor)
      const childMembership = await UserMembership.findOne({
        where: {
          userId: user.id,
          collectionId: child.id,
        },
      });

      expect(childMembership).toBeTruthy();
      expect(childMembership!.permission).toEqual(CollectionPermission.Read);
    });
  });

  describe("group membership inheritance", () => {
    it("should create inherited group memberships from parent", async () => {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const group = await buildGroup({ teamId: team.id });

      // Create parent with group membership
      const parent = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
      });

      await GroupMembership.create({
        groupId: group.id,
        collectionId: parent.id,
        permission: CollectionPermission.ReadWrite,
        createdById: admin.id,
      });

      // Create child under parent
      const child = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
        parentCollectionId: parent.id,
      });

      // Run recalculator
      await collectionPermissionRecalculator({ collection: child });

      // Verify child has inherited group membership
      const childMembership = await GroupMembership.findOne({
        where: {
          groupId: group.id,
          collectionId: child.id,
        },
      });

      expect(childMembership).toBeTruthy();
      expect(childMembership!.permission).toEqual(CollectionPermission.ReadWrite);
      expect(childMembership!.sourceId).toBeTruthy();
    });

    it("should preserve explicit group overrides during recalculation", async () => {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const group = await buildGroup({ teamId: team.id });

      // Parent has Admin group permission
      const parent = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
      });

      await GroupMembership.create({
        groupId: group.id,
        collectionId: parent.id,
        permission: CollectionPermission.Admin,
        createdById: admin.id,
      });

      // Child has explicit ReadOnly override
      const child = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
        parentCollectionId: parent.id,
      });

      await GroupMembership.create({
        groupId: group.id,
        collectionId: child.id,
        permission: CollectionPermission.Read,
        createdById: admin.id,
        sourceId: null, // explicit
      });

      // Run recalculator
      await collectionPermissionRecalculator({ collection: child });

      // Verify explicit override preserved
      const childMembership = await GroupMembership.findOne({
        where: {
          groupId: group.id,
          collectionId: child.id,
        },
      });

      expect(childMembership).toBeTruthy();
      expect(childMembership!.permission).toEqual(CollectionPermission.Read);
      expect(childMembership!.sourceId).toBeNull();
    });
  });

  describe("descendant propagation", () => {
    it("should recalculate permissions for all descendants", async () => {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const user = await buildUser({ teamId: team.id });

      // Create hierarchy: parent -> child -> grandchild
      const parent = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
      });

      await UserMembership.create({
        userId: user.id,
        collectionId: parent.id,
        permission: CollectionPermission.Admin,
        createdById: admin.id,
      });

      const child = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
        parentCollectionId: parent.id,
      });

      const grandchild = await buildCollection({
        teamId: team.id,
        userId: admin.id,
        permission: null,
        parentCollectionId: child.id,
      });

      // Run recalculator on child (should also update grandchild)
      await collectionPermissionRecalculator({ collection: child });

      // Verify both child and grandchild have inherited membership
      const childMembership = await UserMembership.findOne({
        where: { userId: user.id, collectionId: child.id },
      });
      const grandchildMembership = await UserMembership.findOne({
        where: { userId: user.id, collectionId: grandchild.id },
      });

      expect(childMembership).toBeTruthy();
      expect(childMembership!.sourceId).toBeTruthy();
      expect(grandchildMembership).toBeTruthy();
      expect(grandchildMembership!.sourceId).toBeTruthy();
    });
  });
});
