import fs from "fs-extra";
import JSZip from "jszip";
import { CollectionPropertyDefinitionState, DocumentPropertyType } from "@shared/types";
import { Collection, PropertyDefinition } from "@server/models";
import {
  buildCollection,
  buildDocument,
  buildFileOperation,
  buildUser,
} from "@server/test/factories";
import * as collectionPropertyDefinitions from "@server/utils/collectionPropertyDefinitions";
import ExportJSONTask from "./ExportJSONTask";

describe("ExportJSONTask", () => {
  it("serializes user property values as ordered user emails", async () => {
    const exporter = await buildUser();
    const collection = await buildCollection({
      teamId: exporter.teamId,
      userId: exporter.id,
      name: "People",
    });
    const assignee = await buildUser({
      teamId: exporter.teamId,
      email: "assignee@example.com",
    });
    const reviewer = await buildUser({
      teamId: exporter.teamId,
      email: "reviewer@example.com",
    });
    const foreignUser = await buildUser({
      email: "foreign@example.com",
    });
    const definition = await PropertyDefinition.create({
      collectionId: collection.id,
      teamId: exporter.teamId,
      name: "Assignees",
      description: null,
      type: DocumentPropertyType.User,
      required: false,
      createdById: exporter.id,
      lastModifiedById: exporter.id,
    });
    const document = await buildDocument({
      teamId: exporter.teamId,
      userId: exporter.id,
      collectionId: collection.id,
      title: "Export me",
      properties: {
        [definition.id]: [assignee.id, foreignUser.id, reviewer.id],
      },
    });
    const fileOperation = await buildFileOperation({
      teamId: exporter.teamId,
      userId: exporter.id,
      collectionId: collection.id,
    });
    jest
      .spyOn(
        collectionPropertyDefinitions,
        "resolveCollectionPropertyDefinitions"
      )
      .mockResolvedValue({
        effective: [
          {
            id: "collection-property-definition",
            collectionId: collection.id,
            propertyDefinitionId: definition.id,
            sourceCollectionId: collection.id,
            sourceCollectionName: collection.name,
            state: CollectionPropertyDefinitionState.Attached,
            required: false,
            inheritToChildren: true,
            index: "a0",
            isInherited: false,
            isCustomized: false,
            isOverwritten: false,
            shadowed: undefined,
            definition,
          },
        ],
        hidden: [],
        local: [],
      });
    const exportCollection = await Collection.findByPk(collection.id, {
      includeDocumentStructure: true,
      rejectOnEmpty: true,
    });

    const task = new ExportJSONTask();
    const zipPath = await task.exportCollections(
      [exportCollection],
      fileOperation
    );
    const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
    const jsonPath = Object.keys(zip.files).find(
      (name) => name.endsWith(".json") && name !== "metadata.json"
    );

    expect(jsonPath).toBeTruthy();

    const content = await zip.file(jsonPath!)?.async("text");
    const parsed = JSON.parse(content ?? "{}");

    expect(parsed.propertyDefinitions).toEqual([
      expect.objectContaining({
        id: definition.id,
        name: "Assignees",
        type: DocumentPropertyType.User,
      }),
    ]);
    expect(parsed.collectionPropertyDefinitions).toEqual([
      expect.objectContaining({
        propertyDefinitionId: definition.id,
        state: CollectionPropertyDefinitionState.Attached,
        required: false,
        inheritToChildren: true,
      }),
    ]);
    expect(parsed.documents[document.id].properties[definition.id]).toEqual([
      assignee.email,
      reviewer.email,
    ]);

    await fs.remove(zipPath);
  });
});
