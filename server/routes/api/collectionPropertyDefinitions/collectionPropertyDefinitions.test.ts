import {
  CollectionPropertyDefinitionState,
  DocumentPropertyType,
} from "@shared/types";
import {
  CollectionPropertyDefinition,
  PropertyDefinition,
} from "@server/models";
import { buildCollection, buildUser } from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

async function createDefinitionForCollection({
  collectionId,
  teamId,
  userId,
  name,
  required = false,
}: {
  collectionId: string;
  teamId: string;
  userId: string;
  name: string;
  required?: boolean;
}) {
  const definition = await PropertyDefinition.create({
    collectionId,
    teamId,
    name,
    description: null,
    type: DocumentPropertyType.Text,
    required,
    createdById: userId,
    lastModifiedById: userId,
  });

  await CollectionPropertyDefinition.create({
    collectionId,
    propertyDefinitionId: definition.id,
    state: CollectionPropertyDefinitionState.Attached,
    required,
    inheritToChildren: true,
    index: "a0",
    teamId,
    createdById: userId,
    lastModifiedById: userId,
  });

  return definition;
}

describe("#collectionPropertyDefinitions.list", () => {
  it("includes inherited properties and excludes effective properties from available definitions", async () => {
    const user = await buildUser();
    const parent = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const child = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
      parentCollectionId: parent.id,
    });
    const definition = await createDefinitionForCollection({
      collectionId: parent.id,
      teamId: user.teamId,
      userId: user.id,
      name: "Status",
    });

    const res = await server.post("/api/collectionPropertyDefinitions.list", {
      body: {
        token: user.getJwtToken(),
        collectionId: child.id,
      },
    });

    expect(res.status).toEqual(200);
    const body = await res.json();

    expect(body.data.effective).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          propertyDefinitionId: definition.id,
          sourceCollectionId: parent.id,
          sourceCollectionName: parent.name,
          isInherited: true,
          state: "attached",
        }),
      ])
    );
    expect(body.data.available).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: definition.id,
        }),
      ])
    );
  });

  it("stops inheriting when a parent property disables children inherit", async () => {
    const user = await buildUser();
    const parent = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const child = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
      parentCollectionId: parent.id,
    });
    const definition = await createDefinitionForCollection({
      collectionId: parent.id,
      teamId: user.teamId,
      userId: user.id,
      name: "Severity",
    });

    await server.post("/api/collectionPropertyDefinitions.save", {
      body: {
        token: user.getJwtToken(),
        collectionId: parent.id,
        replaceLocal: true,
        rows: [
          {
            propertyDefinitionId: definition.id,
            state: CollectionPropertyDefinitionState.Attached,
            required: false,
            inheritToChildren: false,
            index: "a0",
          },
        ],
      },
    });

    const parentRes = await server.post(
      "/api/collectionPropertyDefinitions.list",
      {
        body: {
          token: user.getJwtToken(),
          collectionId: parent.id,
        },
      }
    );
    const childRes = await server.post(
      "/api/collectionPropertyDefinitions.list",
      {
        body: {
          token: user.getJwtToken(),
          collectionId: child.id,
        },
      }
    );

    expect(parentRes.status).toEqual(200);
    expect(childRes.status).toEqual(200);

    const parentBody = await parentRes.json();
    const childBody = await childRes.json();

    expect(parentBody.data.effective).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          propertyDefinitionId: definition.id,
          inheritToChildren: false,
        }),
      ])
    );
    expect(childBody.data.effective).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          propertyDefinitionId: definition.id,
        }),
      ])
    );
  });

  it("keeps a hidden inherited property visible in the hidden list and out of the picker", async () => {
    const user = await buildUser();
    const parent = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const child = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
      parentCollectionId: parent.id,
    });
    const definition = await createDefinitionForCollection({
      collectionId: parent.id,
      teamId: user.teamId,
      userId: user.id,
      name: "Owner",
      required: true,
    });

    await CollectionPropertyDefinition.create({
      collectionId: child.id,
      propertyDefinitionId: definition.id,
      state: CollectionPropertyDefinitionState.Excluded,
      required: false,
      inheritToChildren: false,
      index: null,
      teamId: user.teamId,
      createdById: user.id,
      lastModifiedById: user.id,
    });

    const childRes = await server.post(
      "/api/collectionPropertyDefinitions.list",
      {
        body: {
          token: user.getJwtToken(),
          collectionId: child.id,
        },
      }
    );
    expect(childRes.status).toEqual(200);

    const childBody = await childRes.json();

    expect(childBody.data.effective).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          propertyDefinitionId: definition.id,
        }),
      ])
    );
    expect(childBody.data.hidden).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          propertyDefinitionId: definition.id,
          sourceCollectionId: parent.id,
          sourceCollectionName: parent.name,
          required: true,
          state: "excluded",
        }),
      ])
    );
    expect(childBody.data.available).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: definition.id,
        }),
      ])
    );
  });

  it("restores inherited required state when a hidden property is shown again", async () => {
    const user = await buildUser();
    const parent = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const child = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
      parentCollectionId: parent.id,
    });
    const definition = await createDefinitionForCollection({
      collectionId: parent.id,
      teamId: user.teamId,
      userId: user.id,
      name: "Priority",
      required: true,
    });

    await CollectionPropertyDefinition.create({
      collectionId: child.id,
      propertyDefinitionId: definition.id,
      state: CollectionPropertyDefinitionState.Excluded,
      required: false,
      inheritToChildren: false,
      index: null,
      teamId: user.teamId,
      createdById: user.id,
      lastModifiedById: user.id,
    });

    const res = await server.post("/api/collectionPropertyDefinitions.save", {
      body: {
        token: user.getJwtToken(),
        collectionId: child.id,
        replaceLocal: true,
        rows: [],
      },
    });

    expect(res.status).toEqual(200);
    const body = await res.json();

    expect(body.data.effective).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          propertyDefinitionId: definition.id,
          sourceCollectionId: parent.id,
          required: true,
          inheritToChildren: true,
        }),
      ])
    );
    expect(body.data.hidden).toEqual([]);
  });

  it("includes shadowed metadata for a local row that overwrites an inherited property", async () => {
    const user = await buildUser();
    const parent = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const child = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
      parentCollectionId: parent.id,
    });
    const definition = await createDefinitionForCollection({
      collectionId: parent.id,
      teamId: user.teamId,
      userId: user.id,
      name: "Status",
      required: true,
    });

    await CollectionPropertyDefinition.create({
      collectionId: child.id,
      propertyDefinitionId: definition.id,
      state: CollectionPropertyDefinitionState.Attached,
      required: false,
      inheritToChildren: true,
      index: "b0",
      teamId: user.teamId,
      createdById: user.id,
      lastModifiedById: user.id,
    });

    const res = await server.post("/api/collectionPropertyDefinitions.list", {
      body: {
        token: user.getJwtToken(),
        collectionId: child.id,
      },
    });

    expect(res.status).toEqual(200);
    const body = await res.json();

    expect(body.data.effective).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          propertyDefinitionId: definition.id,
          isOverwritten: true,
          shadowed: expect.objectContaining({
            sourceCollectionId: parent.id,
            sourceCollectionName: parent.name,
            required: true,
            inheritToChildren: true,
          }),
        }),
      ])
    );
  });
});
