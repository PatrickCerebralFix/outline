import { DocumentPropertyType } from "@shared/types";
import {
  Document,
  DocumentProperty,
  PropertyDefinition,
  PropertyDefinitionOption,
} from "@server/models";
import {
  buildCollection,
  buildDocument,
  buildUser,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

describe("#propertyDefinitions.update", () => {
  it("creates and deletes a definition without group memberships", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });

    const createRes = await server.post("/api/propertyDefinitions.create", {
      body: {
        token: user.getJwtToken(),
        collectionId: collection.id,
        name: "Priority",
        description: null,
        type: DocumentPropertyType.Text,
        required: false,
        options: [],
      },
    });

    expect(createRes.status).toEqual(200);
    const createBody = await createRes.json();

    const deleteRes = await server.post("/api/propertyDefinitions.delete", {
      body: {
        token: user.getJwtToken(),
        id: createBody.data.id,
      },
    });

    expect(deleteRes.status).toEqual(200);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.success).toEqual(true);
  });

  it("updates denormalized snapshot metadata for selected options", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const definition = await PropertyDefinition.create({
      collectionId: collection.id,
      teamId: user.teamId,
      name: "Status",
      description: null,
      type: DocumentPropertyType.Select,
      required: false,
      createdById: user.id,
      lastModifiedById: user.id,
    });
    const option = await PropertyDefinitionOption.create({
      propertyDefinitionId: definition.id,
      teamId: user.teamId,
      label: "In progress",
      value: "In progress",
      color: "#111111",
      index: "0",
      createdById: user.id,
      lastModifiedById: user.id,
    });
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      collectionId: collection.id,
    });

    await DocumentProperty.create({
      documentId: document.id,
      propertyDefinitionId: definition.id,
      value: option.id,
      teamId: user.teamId,
      createdById: user.id,
      lastModifiedById: user.id,
    });

    document.properties = {
      [definition.id]: {
        definitionId: definition.id,
        name: "Status",
        type: DocumentPropertyType.Select,
        value: option.id,
        options: [
          {
            id: option.id,
            value: option.value,
            color: option.color,
          },
        ],
      },
    };
    await document.save();

    const res = await server.post("/api/propertyDefinitions.update", {
      body: {
        token: user.getJwtToken(),
        id: definition.id,
        name: "Lifecycle",
        options: [
          {
            id: option.id,
            label: "Done",
            value: "Completed",
            color: "#00FF00",
            index: "0",
          },
        ],
      },
    });

    expect(res.status).toEqual(200);

    const refreshedDocument = await Document.unscoped().findByPk(document.id, {
      rejectOnEmpty: true,
    });
    const refreshedProperty = refreshedDocument.properties[definition.id];
    const refreshedRow = await DocumentProperty.findOne({
      where: {
        documentId: document.id,
        propertyDefinitionId: definition.id,
      },
      rejectOnEmpty: true,
    });

    expect(refreshedProperty.name).toEqual("Lifecycle");
    expect(refreshedProperty.options).toEqual([
      {
        id: option.id,
        value: "Completed",
        color: "#00FF00",
      },
    ]);
    expect(refreshedRow.value).toEqual(option.id);
  });

  it("removes stale select values when selected option is deleted", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const definition = await PropertyDefinition.create({
      collectionId: collection.id,
      teamId: user.teamId,
      name: "Status",
      description: null,
      type: DocumentPropertyType.Select,
      required: false,
      createdById: user.id,
      lastModifiedById: user.id,
    });
    const remaining = await PropertyDefinitionOption.create({
      propertyDefinitionId: definition.id,
      teamId: user.teamId,
      label: "Todo",
      value: "Todo",
      color: "#555555",
      index: "0",
      createdById: user.id,
      lastModifiedById: user.id,
    });
    const removed = await PropertyDefinitionOption.create({
      propertyDefinitionId: definition.id,
      teamId: user.teamId,
      label: "Done",
      value: "Done",
      color: "#00FF00",
      index: "1",
      createdById: user.id,
      lastModifiedById: user.id,
    });
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      collectionId: collection.id,
    });

    await DocumentProperty.create({
      documentId: document.id,
      propertyDefinitionId: definition.id,
      value: removed.id,
      teamId: user.teamId,
      createdById: user.id,
      lastModifiedById: user.id,
    });

    document.properties = {
      [definition.id]: {
        definitionId: definition.id,
        name: definition.name,
        type: definition.type,
        value: removed.id,
        options: [
          {
            id: removed.id,
            value: removed.value,
            color: removed.color,
          },
        ],
      },
    };
    await document.save();

    const res = await server.post("/api/propertyDefinitions.update", {
      body: {
        token: user.getJwtToken(),
        id: definition.id,
        options: [
          {
            id: remaining.id,
            label: remaining.label,
            value: remaining.value,
            color: remaining.color,
            index: "0",
          },
        ],
      },
    });

    expect(res.status).toEqual(200);

    const refreshedDocument = await Document.unscoped().findByPk(document.id, {
      rejectOnEmpty: true,
    });
    const refreshedRow = await DocumentProperty.findOne({
      where: {
        documentId: document.id,
        propertyDefinitionId: definition.id,
      },
    });

    expect(refreshedRow).toBeNull();
    expect(Object.keys(refreshedDocument.properties)).not.toContain(
      definition.id
    );
  });

  it("filters stale multi-select option IDs and keeps valid values", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const definition = await PropertyDefinition.create({
      collectionId: collection.id,
      teamId: user.teamId,
      name: "Labels",
      description: null,
      type: DocumentPropertyType.MultiSelect,
      required: false,
      createdById: user.id,
      lastModifiedById: user.id,
    });
    const remaining = await PropertyDefinitionOption.create({
      propertyDefinitionId: definition.id,
      teamId: user.teamId,
      label: "Important",
      value: "Important",
      color: "#AA0000",
      index: "0",
      createdById: user.id,
      lastModifiedById: user.id,
    });
    const removed = await PropertyDefinitionOption.create({
      propertyDefinitionId: definition.id,
      teamId: user.teamId,
      label: "Optional",
      value: "Optional",
      color: "#00AA00",
      index: "1",
      createdById: user.id,
      lastModifiedById: user.id,
    });
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      collectionId: collection.id,
    });

    await DocumentProperty.create({
      documentId: document.id,
      propertyDefinitionId: definition.id,
      value: [remaining.id, removed.id],
      teamId: user.teamId,
      createdById: user.id,
      lastModifiedById: user.id,
    });

    document.properties = {
      [definition.id]: {
        definitionId: definition.id,
        name: definition.name,
        type: definition.type,
        value: [remaining.id, removed.id],
        options: [
          {
            id: remaining.id,
            value: remaining.value,
            color: remaining.color,
          },
          {
            id: removed.id,
            value: removed.value,
            color: removed.color,
          },
        ],
      },
    };
    await document.save();

    const res = await server.post("/api/propertyDefinitions.update", {
      body: {
        token: user.getJwtToken(),
        id: definition.id,
        options: [
          {
            id: remaining.id,
            label: "Pinned",
            value: "Pinned",
            color: "#CC0000",
            index: "0",
          },
        ],
      },
    });

    expect(res.status).toEqual(200);

    const refreshedDocument = await Document.unscoped().findByPk(document.id, {
      rejectOnEmpty: true,
    });
    const refreshedProperty = refreshedDocument.properties[definition.id];
    const refreshedRow = await DocumentProperty.findOne({
      where: {
        documentId: document.id,
        propertyDefinitionId: definition.id,
      },
      rejectOnEmpty: true,
    });

    expect(refreshedRow.value).toEqual([remaining.id]);
    expect(refreshedProperty.value).toEqual([remaining.id]);
    expect(refreshedProperty.options).toEqual([
      {
        id: remaining.id,
        value: "Pinned",
        color: "#CC0000",
      },
    ]);
  });
});
