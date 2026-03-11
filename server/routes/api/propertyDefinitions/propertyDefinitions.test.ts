import { DocumentPropertyType } from "@shared/types";
import { reconcileDocumentPropertyOptions } from "@server/commands/documentPropertyUpdater";
import {
  Document,
  DocumentProperty,
  PropertyDefinition,
  PropertyDefinitionOption,
} from "@server/models";
import ReconcileDocumentPropertyOptionsTask from "@server/queues/tasks/ReconcileDocumentPropertyOptionsTask";
import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildUser,
} from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();

afterEach(() => {
  jest.restoreAllMocks();
});

describe("#propertyDefinitions.update", () => {
  it("creates and deletes a definition without group memberships", async () => {
    const user = await buildAdmin();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });

    const createRes = await server.post("/api/propertyDefinitions.create", {
      body: {
        token: user.getJwtToken(),
        name: "Priority",
        description: null,
        type: DocumentPropertyType.Text,
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

  it("allows duplicate definitions with the same trimmed name and type", async () => {
    const user = await buildAdmin();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });

    await PropertyDefinition.create({
      collectionId: collection.id,
      teamId: user.teamId,
      name: "Priority",
      description: null,
      type: DocumentPropertyType.Text,
      required: false,
      createdById: user.id,
      lastModifiedById: user.id,
    });

    const res = await server.post("/api/propertyDefinitions.create", {
      body: {
        token: user.getJwtToken(),
        name: "  Priority  ",
        description: null,
        type: DocumentPropertyType.Text,
        options: [],
      },
    });

    expect(res.status).toEqual(200);

    const definitions = await PropertyDefinition.findAll({
      where: {
        teamId: user.teamId,
        type: DocumentPropertyType.Text,
      },
    });

    expect(
      definitions.filter(
        (definition) => definition.name.trim() === "Priority"
      )
    ).toHaveLength(2);
  });

  it("does not enqueue reconciliation for name-only updates", async () => {
    const user = await buildAdmin();
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
    const schedule = jest
      .spyOn(ReconcileDocumentPropertyOptionsTask.prototype, "schedule")
      .mockResolvedValue({} as never);

    const res = await server.post("/api/propertyDefinitions.update", {
      body: {
        token: user.getJwtToken(),
        id: definition.id,
        name: "Lifecycle",
      },
    });

    expect(res.status).toEqual(200);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("rejects options for user properties", async () => {
    const user = await buildAdmin();

    const res = await server.post("/api/propertyDefinitions.create", {
      body: {
        token: user.getJwtToken(),
        name: "Assignees",
        description: null,
        type: DocumentPropertyType.User,
        options: [
          {
            label: "Ignored",
            value: "ignored",
            color: null,
            index: "0",
          },
        ],
      },
    });

    expect(res.status).toEqual(400);
  });

  it("enqueues reconciliation when selectable options change", async () => {
    const user = await buildAdmin();
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
      label: "Todo",
      value: "Todo",
      color: "#111111",
      index: "0",
      createdById: user.id,
      lastModifiedById: user.id,
    });
    const schedule = jest
      .spyOn(ReconcileDocumentPropertyOptionsTask.prototype, "schedule")
      .mockResolvedValue({} as never);

    const res = await server.post("/api/propertyDefinitions.update", {
      body: {
        token: user.getJwtToken(),
        id: definition.id,
        options: [
          {
            id: option.id,
            label: "In progress",
            value: "In progress",
            color: "#00FF00",
            index: "0",
          },
        ],
      },
    });

    expect(res.status).toEqual(200);
    expect(schedule).toHaveBeenCalledWith({
      propertyDefinitionId: definition.id,
      userId: user.id,
    });
  });
});

describe("reconcileDocumentPropertyOptions", () => {
  it("removes stale select values when the selected option is deleted", async () => {
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
    const removed = await PropertyDefinitionOption.create({
      propertyDefinitionId: definition.id,
      teamId: user.teamId,
      label: "Done",
      value: "Done",
      color: "#00FF00",
      index: "0",
      createdById: user.id,
      lastModifiedById: user.id,
    });
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      collectionId: collection.id,
      properties: {
        [definition.id]: removed.id,
      },
    });

    await DocumentProperty.create({
      documentId: document.id,
      propertyDefinitionId: definition.id,
      value: removed.id,
      teamId: user.teamId,
      createdById: user.id,
      lastModifiedById: user.id,
    });

    await removed.destroy();
    await reconcileDocumentPropertyOptions({
      propertyDefinitionId: definition.id,
      userId: user.id,
    });

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
    expect(refreshedDocument.properties[definition.id]).toBeUndefined();
  });

  it("hydrates required select values to an empty string when the option is deleted", async () => {
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
      required: true,
      createdById: user.id,
      lastModifiedById: user.id,
    });
    const removed = await PropertyDefinitionOption.create({
      propertyDefinitionId: definition.id,
      teamId: user.teamId,
      label: "Done",
      value: "Done",
      color: "#00FF00",
      index: "0",
      createdById: user.id,
      lastModifiedById: user.id,
    });
    const document = await buildDocument({
      userId: user.id,
      teamId: user.teamId,
      collectionId: collection.id,
      properties: {
        [definition.id]: removed.id,
      },
    });

    await DocumentProperty.create({
      documentId: document.id,
      propertyDefinitionId: definition.id,
      value: removed.id,
      teamId: user.teamId,
      createdById: user.id,
      lastModifiedById: user.id,
    });

    await removed.destroy();
    await reconcileDocumentPropertyOptions({
      propertyDefinitionId: definition.id,
      userId: user.id,
    });

    const refreshedDocument = await Document.unscoped().findByPk(document.id, {
      rejectOnEmpty: true,
    });
    const refreshedRow = await DocumentProperty.findOne({
      where: {
        documentId: document.id,
        propertyDefinitionId: definition.id,
      },
      rejectOnEmpty: true,
    });

    expect(refreshedRow.value).toEqual("");
    expect(refreshedDocument.properties[definition.id]).toEqual("");
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
      properties: {
        [definition.id]: [remaining.id, removed.id],
      },
    });

    await DocumentProperty.create({
      documentId: document.id,
      propertyDefinitionId: definition.id,
      value: [remaining.id, removed.id],
      teamId: user.teamId,
      createdById: user.id,
      lastModifiedById: user.id,
    });

    await removed.destroy();
    await reconcileDocumentPropertyOptions({
      propertyDefinitionId: definition.id,
      userId: user.id,
    });

    const refreshedDocument = await Document.unscoped().findByPk(document.id, {
      rejectOnEmpty: true,
    });
    const refreshedRow = await DocumentProperty.findOne({
      where: {
        documentId: document.id,
        propertyDefinitionId: definition.id,
      },
      rejectOnEmpty: true,
    });

    expect(refreshedRow.value).toEqual([remaining.id]);
    expect(refreshedDocument.properties[definition.id]).toEqual([remaining.id]);
  });
});
