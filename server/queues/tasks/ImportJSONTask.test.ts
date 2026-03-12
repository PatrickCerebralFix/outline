import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
  CollectionPropertyDefinitionState,
  DocumentPropertyType,
} from "@shared/types";
import { FileOperation } from "@server/models";
import Logger from "@server/logging/Logger";
import { buildFileOperation, buildUser } from "@server/test/factories";
import ImportJSONTask from "./ImportJSONTask";

describe("ImportJSONTask", () => {
  it("should import the documents, attachments", async () => {
    const fileOperation = await buildFileOperation();
    const dirPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "outline-import-json-perform-")
    );
    const attachmentPath = path.join(dirPath, "uploads", "hello.txt");
    await fs.ensureDir(path.dirname(attachmentPath));
    await fs.writeFile(attachmentPath, "hello");
    await fs.writeJson(path.join(dirPath, "metadata.json"), {
      exportVersion: 1,
      version: "0.0.0-test",
      createdAt: new Date().toISOString(),
      createdById: fileOperation.userId,
      createdByEmail: "importer@example.com",
    });
    await fs.writeJson(path.join(dirPath, "workspace.json"), {
      collection: {
        id: "source-collection",
        urlId: "source-collection",
        name: "Workspace",
        data: {
          type: "doc",
          content: [],
        },
        sort: {
          field: "updatedAt",
          direction: "desc",
        },
        documentStructure: null,
      },
      propertyDefinitions: [],
      collectionPropertyDefinitions: [],
      documents: {
        "source-document-1": {
          id: "source-document-1",
          urlId: "source-document-1",
          title: "Imported 1",
          icon: null,
          color: null,
          data: {
            type: "doc",
            content: [],
          },
          createdById: fileOperation.userId,
          createdByName: "Importer",
          createdByEmail: "importer@example.com",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          publishedAt: new Date().toISOString(),
          fullWidth: false,
          template: false,
          parentDocumentId: null,
          properties: {},
        },
        "source-document-2": {
          id: "source-document-2",
          urlId: "source-document-2",
          title: "Imported 2",
          icon: null,
          color: null,
          data: {
            type: "doc",
            content: [],
          },
          createdById: fileOperation.userId,
          createdByName: "Importer",
          createdByEmail: "importer@example.com",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          publishedAt: new Date().toISOString(),
          fullWidth: false,
          template: false,
          parentDocumentId: null,
          properties: {},
        },
      },
      attachments: {
        "source-attachment": {
          id: "source-attachment",
          documentId: null,
          contentType: "text/plain",
          name: "hello.txt",
          size: 5,
          key: "uploads/hello.txt",
        },
      },
    });
    jest.spyOn(FileOperation, "findByPk").mockResolvedValue(fileOperation);

    const task = new ImportJSONTask();
    jest
      .spyOn(task as any, "fetchAndExtractData")
      .mockResolvedValue(dirPath as never);
    jest
      .spyOn(task as any, "cleanupExtractedData")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(task as any, "persistData")
      .mockImplementation(
        async (
          data: Parameters<ImportJSONTask["persistData"]>[0]
        ): Promise<Awaited<ReturnType<ImportJSONTask["persistData"]>>> => {
          return {
            collections: new Map(data.collections.map((item) => [item.id, item])),
            documents: new Map(data.documents.map((item) => [item.id, item])),
            attachments: new Map(data.attachments.map((item) => [item.id, item])),
          } as unknown as Awaited<ReturnType<ImportJSONTask["persistData"]>>;
        }
      );
    const response = await task.perform({
      fileOperationId: fileOperation.id,
    });

    expect(response.collections.size).toEqual(1);
    expect(response.documents.size).toEqual(2);
    expect(response.attachments.size).toEqual(1);

    await fs.remove(dirPath);
  });

  it("maps exported user property emails back to user IDs", async () => {
    const importer = await buildUser();
    const assignee = await buildUser({
      teamId: importer.teamId,
      email: "assignee@example.com",
    });
    const reviewer = await buildUser({
      teamId: importer.teamId,
      email: "reviewer@example.com",
    });
    const fileOperation = await buildFileOperation({
      teamId: importer.teamId,
      userId: importer.id,
    });
    const dirPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "outline-import-json-")
    );

    await fs.writeJson(path.join(dirPath, "metadata.json"), {
      exportVersion: 1,
      version: "0.0.0-test",
      createdAt: new Date().toISOString(),
      createdById: importer.id,
      createdByEmail: importer.email,
    });
    await fs.writeJson(path.join(dirPath, "workspace.json"), {
      collection: {
        id: "source-collection",
        urlId: "source-collection",
        name: "Workspace",
        sort: {
          field: "updatedAt",
          direction: "desc",
        },
        documentStructure: null,
      },
      propertyDefinitions: [
        {
          id: "user-property",
          name: "Assignees",
          type: DocumentPropertyType.User,
          options: [],
        },
      ],
      collectionPropertyDefinitions: [
        {
          id: "source-collection-property",
          propertyDefinitionId: "user-property",
          state: CollectionPropertyDefinitionState.Attached,
          required: false,
          inheritToChildren: true,
          index: "a0",
        },
      ],
      documents: {
        "source-document": {
          id: "source-document",
          urlId: "source-document",
          title: "Imported",
          icon: null,
          color: null,
          data: {
            type: "doc",
            content: [],
          },
          createdById: importer.id,
          createdByName: importer.name,
          createdByEmail: importer.email,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          publishedAt: new Date().toISOString(),
          fullWidth: false,
          template: false,
          parentDocumentId: null,
          properties: {
            "user-property": [
              assignee.email,
              "missing@example.com",
              reviewer.email,
            ],
          },
        },
      },
      attachments: {},
    });

    const logger = jest.spyOn(Logger, "warn").mockImplementation();

    const task = new ImportJSONTask();
    const result = await task.parseData(dirPath, fileOperation);
    const definition = result.propertyDefinitions[0];
    const collectionPropertyDefinition = result.collectionPropertyDefinitions[0];
    const document = result.documents[0];

    expect(collectionPropertyDefinition.propertyDefinitionId).toEqual(
      definition.id
    );
    expect(collectionPropertyDefinition.state).toEqual(
      CollectionPropertyDefinitionState.Attached
    );
    expect(document.properties?.[definition.id]).toEqual([
      assignee.id,
      reviewer.id,
    ]);
    expect(logger).toHaveBeenCalledWith(
      "Dropped unmatched user property emails during JSON import",
      expect.objectContaining({
        fileOperationId: fileOperation.id,
        teamId: fileOperation.teamId,
        emails: ["missing@example.com"],
      })
    );

    logger.mockRestore();
    await fs.remove(dirPath);
  });
});
