import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import { DocumentPropertyType, TextEditMode } from "@shared/types";
import { APIUpdateExtension } from "@server/collaboration/APIUpdateExtension";
import {
  DocumentProperty,
  Event,
  PropertyDefinition,
  PropertyDefinitionOption,
} from "@server/models";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import {
  buildCollection,
  buildDocument,
  buildPropertyDefinition,
  buildUser,
} from "@server/test/factories";
import { withAPIContext } from "@server/test/support";
import documentUpdater from "./documentUpdater";

describe("documentUpdater", () => {
  it("should change lastModifiedById", async () => {
    const user = await buildUser();
    let document = await buildDocument({
      teamId: user.teamId,
    });

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        text: "Changed",
        document,
      })
    );

    const event = await Event.findLatest({
      teamId: user.teamId,
    });
    expect(document.lastModifiedById).toEqual(user.id);
    expect(event!.name).toEqual("documents.update");
    expect(event!.documentId).toEqual(document.id);
  });

  it("should not change lastModifiedById or generate event if nothing changed", async () => {
    const user = await buildUser();
    let document = await buildDocument({
      teamId: user.teamId,
    });

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        title: document.title,
        document,
      })
    );

    expect(document.lastModifiedById).not.toEqual(user.id);
  });

  it("should hydrate required properties with null values on update", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const definition = await buildPropertyDefinition({
      collectionId: collection.id,
      teamId: user.teamId,
      name: "Status",
      description: null,
      type: DocumentPropertyType.Text,
      required: true,
      userId: user.id,
    });

    let document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      properties: {},
    });

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        document,
        properties: {},
      })
    );

    expect(document.properties[definition.id]).toEqual("");
  });

  it("should hydrate required user properties with empty arrays on update", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const definition = await buildPropertyDefinition({
      collectionId: collection.id,
      teamId: user.teamId,
      name: "Assignees",
      description: null,
      type: DocumentPropertyType.User,
      required: true,
      userId: user.id,
    });

    let document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      properties: {},
    });

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        document,
        properties: {},
      })
    );

    expect(document.properties[definition.id]).toEqual([]);
  });

  it("should upsert document properties across repeated updates", async () => {
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

    let document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      properties: {},
    });

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        document,
        properties: {
          [definition.id]: "Alice",
        },
      })
    );

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        document,
        properties: {
          [definition.id]: "Bob",
        },
      })
    );

    const rows = await DocumentProperty.findAll({
      where: {
        documentId: document.id,
        propertyDefinitionId: definition.id,
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].value).toEqual("Bob");
    expect(document.properties[definition.id]).toEqual("Bob");
  });

  it("should preserve optional text properties when cleared", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const definition = await buildPropertyDefinition({
      collectionId: collection.id,
      teamId: user.teamId,
      name: "Nickname",
      description: null,
      type: DocumentPropertyType.Text,
      required: false,
      userId: user.id,
    });

    let document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      properties: {},
    });

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        document,
        properties: {
          [definition.id]: "Aria",
        },
      })
    );

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        document,
        properties: {
          [definition.id]: "",
        },
      })
    );

    const row = await DocumentProperty.findOne({
      where: {
        documentId: document.id,
        propertyDefinitionId: definition.id,
      },
      rejectOnEmpty: true,
    });

    expect(document.properties[definition.id]).toEqual("");
    expect(row.value).toEqual("");
  });

  it("should preserve optional multi-select properties when cleared", async () => {
    const user = await buildUser();
    const collection = await buildCollection({
      userId: user.id,
      teamId: user.teamId,
    });
    const definition = await buildPropertyDefinition({
      collectionId: collection.id,
      teamId: user.teamId,
      name: "Labels",
      description: null,
      type: DocumentPropertyType.MultiSelect,
      required: false,
      userId: user.id,
    });
    const option = await PropertyDefinitionOption.create({
      propertyDefinitionId: definition.id,
      teamId: user.teamId,
      label: "Rare",
      value: "Rare",
      color: "#FFAA00",
      index: "0",
      createdById: user.id,
      lastModifiedById: user.id,
    });

    let document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      properties: {},
    });

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        document,
        properties: {
          [definition.id]: [option.id],
        },
      })
    );

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        document,
        properties: {
          [definition.id]: [],
        },
      })
    );

    const row = await DocumentProperty.findOne({
      where: {
        documentId: document.id,
        propertyDefinitionId: definition.id,
      },
      rejectOnEmpty: true,
    });

    expect(document.properties[definition.id]).toEqual([]);
    expect(row.value).toEqual([]);
  });

  it("should remove optional properties when value is null", async () => {
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

    let document = await buildDocument({
      teamId: user.teamId,
      userId: user.id,
      collectionId: collection.id,
      properties: {},
    });

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        document,
        properties: {
          [definition.id]: "Alice",
        },
      })
    );

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        document,
        properties: {
          [definition.id]: null,
        },
      })
    );

    const row = await DocumentProperty.findOne({
      where: {
        documentId: document.id,
        propertyDefinitionId: definition.id,
      },
    });

    expect(row).toBeNull();
    expect(document.properties[definition.id]).toBeUndefined();
  });

  it("should update document content when changing text", async () => {
    const user = await buildUser();
    let document = await buildDocument({
      teamId: user.teamId,
    });

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        text: "Changed",
        document,
      })
    );

    expect(document.text).toEqual("Changed");
    expect(document.content).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Changed",
            },
          ],
        },
      ],
    });
  });

  it("should append document content when requested", async () => {
    const user = await buildUser();
    let document = await buildDocument({
      teamId: user.teamId,
      text: "Initial",
    });

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        text: "Appended",
        document,
        editMode: TextEditMode.Append,
      })
    );

    expect(document.text).toEqual("InitialAppended");
    expect(document.content).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "InitialAppended" }],
        },
      ],
    });
  });

  it("should preserve rich content when appending", async () => {
    const user = await buildUser();
    let document = await buildDocument({
      teamId: user.teamId,
      text: "**Bold**",
    });

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        text: "Appended",
        document,
        editMode: TextEditMode.Append,
      })
    );

    expect(document.content).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              marks: [{ type: "strong" }],
              text: "Bold",
            },
            {
              type: "text",
              text: "Appended",
            },
          ],
        },
      ],
    });
  });

  it("should preserve rich content from JSON when appending", async () => {
    const user = await buildUser();
    let document = await buildDocument({
      teamId: user.teamId,
    });
    const id = randomUUID();
    document.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              marks: [{ type: "comment", attrs: { id, userId: id } }],
              text: "Italic",
            },
          ],
        },
      ],
    };
    await document.save();

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        text: "Appended",
        document,
        editMode: TextEditMode.Append,
      })
    );

    expect(document.content).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              marks: [{ type: "comment", attrs: { id, userId: id } }],
              text: "Italic",
            },
            {
              type: "text",
              text: "Appended",
            },
          ],
        },
      ],
    });
  });

  it("should create new paragraph when appending with newline", async () => {
    const user = await buildUser();
    let document = await buildDocument({
      teamId: user.teamId,
      text: "Initial",
    });

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        text: "\n\nAppended",
        document,
        editMode: TextEditMode.Append,
      })
    );

    expect(document.text).toEqual("Initial\n\nAppended");
    expect(document.content).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Initial" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Appended" }],
        },
      ],
    });
  });

  it("should prepend document content when requested", async () => {
    const user = await buildUser();
    let document = await buildDocument({
      teamId: user.teamId,
      text: "Existing",
    });

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        text: "Prepended",
        document,
        editMode: TextEditMode.Prepend,
      })
    );

    expect(document.text).toEqual("PrependedExisting");
    expect(document.content).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "PrependedExisting" }],
        },
      ],
    });
  });

  it("should preserve rich content when prepending", async () => {
    const user = await buildUser();
    let document = await buildDocument({
      teamId: user.teamId,
      text: "**Bold**",
    });

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        text: "Prepended",
        document,
        editMode: TextEditMode.Prepend,
      })
    );

    expect(document.content).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Prepended",
            },
            {
              type: "text",
              marks: [{ type: "strong" }],
              text: "Bold",
            },
          ],
        },
      ],
    });
  });

  it("should create new paragraph when prepending with newline", async () => {
    const user = await buildUser();
    let document = await buildDocument({
      teamId: user.teamId,
      text: "Existing",
    });

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        text: "Prepended\n\n",
        document,
        editMode: TextEditMode.Prepend,
      })
    );

    expect(document.text).toEqual("Prepended\n\nExisting");
    expect(document.content).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Prepended" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Existing" }],
        },
      ],
    });
  });

  it("should notify collaboration server when text changes", async () => {
    const notifyUpdateSpy = jest
      .spyOn(APIUpdateExtension, "notifyUpdate")
      .mockResolvedValue(undefined);

    const user = await buildUser();
    let document = await buildDocument({
      teamId: user.teamId,
      text: "Initial text",
    });

    // Create initial collaborative state (simulating an active collaboration session)
    const ydoc = ProsemirrorHelper.toYDoc("Initial text");
    document.state = Buffer.from(Y.encodeStateAsUpdate(ydoc));
    await document.save();

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        text: "Changed content",
        document,
      })
    );

    expect(notifyUpdateSpy).toHaveBeenCalledWith(document.id, user.id);
    notifyUpdateSpy.mockRestore();
  });

  it("should not notify collaboration server when only title changes", async () => {
    const notifyUpdateSpy = jest
      .spyOn(APIUpdateExtension, "notifyUpdate")
      .mockResolvedValue(undefined);

    const user = await buildUser();
    let document = await buildDocument({
      teamId: user.teamId,
    });

    document = await withAPIContext(user, (ctx) =>
      documentUpdater(ctx, {
        title: "New Title",
        document,
      })
    );

    expect(notifyUpdateSpy).not.toHaveBeenCalled();
    notifyUpdateSpy.mockRestore();
  });
});
