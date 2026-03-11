import { DocumentPropertyType } from "@shared/types";
import { Document, PropertyDefinition } from "@server/models";
import {
  buildCollection,
  buildDocument,
  buildPropertyDefinition,
  buildUser,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

describe("#documents.updateProperties", () => {
  it("patches document properties without replacing other keys", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const first = await buildPropertyDefinition({
      collectionId: collection.id,
      teamId: user.teamId,
      name: "Owner",
      description: null,
      type: DocumentPropertyType.Text,
      required: false,
      userId: user.id,
    });
    const second = await buildPropertyDefinition({
      collectionId: collection.id,
      teamId: user.teamId,
      name: "Status",
      description: null,
      type: DocumentPropertyType.Text,
      required: false,
      userId: user.id,
    });
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      collectionId: collection.id,
      properties: {
        [first.id]: "Alice",
      },
    });

    const res = await server.post("/api/documents.updateProperties", {
      body: {
        token: user.getJwtToken(),
        id: document.id,
        properties: {
          [second.id]: "Draft",
        },
      },
    });

    expect(res.status).toEqual(200);
    const body = await res.json();
    expect(body.data.properties).toEqual({
      [first.id]: "Alice",
      [second.id]: "Draft",
    });
  });

  it("removes a property when null is sent", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const definition = await buildPropertyDefinition({
      collectionId: collection.id,
      teamId: user.teamId,
      name: "Owner",
      description: null,
      type: DocumentPropertyType.Text,
      required: false,
      userId: user.id,
    });
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      collectionId: collection.id,
      properties: {
        [definition.id]: "Alice",
      },
    });

    const res = await server.post("/api/documents.updateProperties", {
      body: {
        token: user.getJwtToken(),
        id: document.id,
        properties: {
          [definition.id]: null,
        },
      },
    });

    expect(res.status).toEqual(200);
    const body = await res.json();
    expect(body.data.properties[definition.id]).toBeUndefined();
  });

  it("stores user properties as ordered unique team user IDs", async () => {
    const actor = await buildUser();
    const assignee = await buildUser({
      teamId: actor.teamId,
    });
    const collection = await buildCollection({
      userId: actor.id,
      teamId: actor.teamId,
    });
    const definition = await buildPropertyDefinition({
      collectionId: collection.id,
      teamId: actor.teamId,
      name: "Assignees",
      description: null,
      type: DocumentPropertyType.User,
      required: false,
      userId: actor.id,
    });
    const document = await buildDocument({
      userId: actor.id,
      teamId: actor.teamId,
      collectionId: collection.id,
    });

    const res = await server.post("/api/documents.updateProperties", {
      body: {
        token: actor.getJwtToken(),
        id: document.id,
        properties: {
          [definition.id]: [assignee.id, actor.id, assignee.id],
        },
      },
    });

    expect(res.status).toEqual(200);
    const body = await res.json();
    expect(body.data.properties[definition.id]).toEqual([assignee.id, actor.id]);
  });

  it("rejects user properties containing users outside the workspace", async () => {
    const actor = await buildUser();
    const foreignUser = await buildUser();
    const collection = await buildCollection({
      userId: actor.id,
      teamId: actor.teamId,
    });
    const definition = await buildPropertyDefinition({
      collectionId: collection.id,
      teamId: actor.teamId,
      name: "Assignees",
      description: null,
      type: DocumentPropertyType.User,
      required: false,
      userId: actor.id,
    });
    const document = await buildDocument({
      userId: actor.id,
      teamId: actor.teamId,
      collectionId: collection.id,
    });

    const res = await server.post("/api/documents.updateProperties", {
      body: {
        token: actor.getJwtToken(),
        id: document.id,
        properties: {
          [definition.id]: [foreignUser.id],
        },
      },
    });

    expect(res.status).toEqual(400);
  });
});

describe("#documents.update property safety", () => {
  it("does not rewrite properties when properties are omitted", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const definition = await buildPropertyDefinition({
      collectionId: collection.id,
      teamId: user.teamId,
      name: "Owner",
      description: null,
      type: DocumentPropertyType.Text,
      required: false,
      userId: user.id,
    });
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      collectionId: collection.id,
      properties: {
        [definition.id]: "Alice",
      },
      title: "Before",
    });

    const res = await server.post("/api/documents.update", {
      body: {
        token: user.getJwtToken(),
        id: document.id,
        title: "After",
      },
    });

    expect(res.status).toEqual(200);
    const reloaded = await Document.unscoped().findByPk(document.id, {
      rejectOnEmpty: true,
    });
    expect(reloaded.properties).toEqual({
      [definition.id]: "Alice",
    });
  });

  it("ignores caller supplied collectionId for property validation unless publishing", async () => {
    const user = await buildUser();
    const collectionA = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const collectionB = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const definitionB = await buildPropertyDefinition({
      collectionId: collectionB.id,
      teamId: user.teamId,
      name: "Status",
      description: null,
      type: DocumentPropertyType.Text,
      required: false,
      userId: user.id,
    });
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      collectionId: collectionA.id,
      properties: {},
    });

    const res = await server.post("/api/documents.update", {
      body: {
        token: user.getJwtToken(),
        id: document.id,
        collectionId: collectionB.id,
        properties: {
          [definitionB.id]: "Draft",
        },
      },
    });

    expect(res.status).toEqual(400);
  });
});
