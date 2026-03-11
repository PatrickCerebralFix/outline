import path from "node:path";
import fs from "fs-extra";
import find from "lodash/find";
import mime from "mime-types";
import { Fragment, Node } from "prosemirror-model";
import { randomUUID } from "node:crypto";
import {
  CollectionPropertyDefinitionState,
  DocumentPropertyType,
  type ProsemirrorData,
} from "@shared/types";
import { schema, serializer } from "@server/editor";
import Logger from "@server/logging/Logger";
import type { FileOperation } from "@server/models";
import { Attachment, User } from "@server/models";
import type {
  AttachmentJSONExport,
  CollectionJSONExport,
  CollectionPropertyDefinitionJSONExport,
  DocumentJSONExport,
  JSONExportMetadata,
  PropertyDefinitionJSONExport,
} from "@server/types";
import type { DocumentPropertyInput } from "@server/commands/documentPropertyUpdater";
import type { FileTreeNode } from "@server/utils/ImportHelper";
import ImportHelper from "@server/utils/ImportHelper";
import type { StructuredImportData } from "./ImportTask";
import ImportTask from "./ImportTask";

export default class ImportJSONTask extends ImportTask {
  public async parseData(
    dirPath: string,
    fileOperation: FileOperation
  ): Promise<StructuredImportData> {
    const tree = await ImportHelper.toFileTree(dirPath);
    if (!tree) {
      throw new Error("Could not find valid content in zip file");
    }
    return this.parseFileTree(tree.children, fileOperation);
  }

  /**
   * Converts the file structure from zipAsFileTree into documents,
   * collections, and attachments.
   *
   * @param tree An array of FileTreeNode representing root files in the zip
   * @returns A StructuredImportData object
   */
  private async parseFileTree(
    tree: FileTreeNode[],
    fileOperation: FileOperation
  ): Promise<StructuredImportData> {
    let rootPath = "";
    const output: StructuredImportData = {
      collections: [],
      documents: [],
      propertyDefinitions: [],
      collectionPropertyDefinitions: [],
      attachments: [],
    };
    const userIdByEmail = await this.loadUserIdByEmail(fileOperation.teamId);
    const unmatchedUserEmails = new Set<string>();
    const definitionIdMap = new Map<string, string>();
    const definitionTypeMap = new Map<string, DocumentPropertyType>();
    const optionIdMap = new Map<string, string>();

    // Load metadata
    let metadata: JSONExportMetadata | undefined = undefined;
    for (const node of tree) {
      if (!rootPath) {
        rootPath = path.dirname(node.path);
      }
      if (node.path === "metadata.json") {
        try {
          metadata = JSON.parse(await fs.readFile(node.path, "utf8"));
        } catch (err) {
          throw new Error(`Could not parse metadata.json. ${err.message}`);
        }
      }
    }

    if (!rootPath) {
      throw new Error("Could not find root path");
    }

    Logger.debug("task", "Importing JSON metadata", { metadata });

    function mapDocuments(
      documents: { [id: string]: DocumentJSONExport },
      collectionId: string
    ) {
      Object.values(documents).forEach((node) => {
        const id = randomUUID();
        const properties = node.properties
          ? (Object.fromEntries(
              Object.entries(node.properties).map(([propertyId, property]) => {
                const mappedPropertyId =
                  definitionIdMap.get(propertyId) ?? propertyId;
                const rawValue = property;
                const definitionType = definitionTypeMap.get(propertyId);
                const shouldMapOptionIds =
                  definitionType === DocumentPropertyType.Select ||
                  definitionType === DocumentPropertyType.MultiSelect;
                const shouldMapUserEmails =
                  definitionType === DocumentPropertyType.User;
                const mappedValue = shouldMapOptionIds
                  ? Array.isArray(rawValue)
                    ? rawValue.map((value) =>
                        typeof value === "string"
                          ? (optionIdMap.get(value) ?? value)
                          : value
                      )
                    : typeof rawValue === "string"
                      ? (optionIdMap.get(rawValue) ?? rawValue)
                      : rawValue
                  : shouldMapUserEmails
                    ? mapUserPropertyValue(
                        rawValue,
                        userIdByEmail,
                        unmatchedUserEmails
                      )
                    : rawValue;

                return [mappedPropertyId, mappedValue];
              })
            ) as DocumentPropertyInput)
          : undefined;

        output.documents.push({
          ...node,
          path: "",
          text: "",
          data: node.data,
          icon: node.icon ?? node.emoji,
          color: node.color,
          createdAt: node.createdAt ? new Date(node.createdAt) : undefined,
          updatedAt: node.updatedAt ? new Date(node.updatedAt) : undefined,
          publishedAt: node.publishedAt ? new Date(node.publishedAt) : null,
          collectionId,
          externalId: node.id,
          mimeType: "application/json",
          properties,
          parentDocumentId: node.parentDocumentId
            ? find(
                output.documents,
                (d) => d.externalId === node.parentDocumentId
              )?.id
            : null,
          id,
        });
      });
    }

    function mapPropertyDefinitions(definitions: PropertyDefinitionJSONExport[]) {
      for (const definition of definitions) {
        const existingId = definitionIdMap.get(definition.id);

        if (existingId) {
          definitionTypeMap.set(definition.id, definition.type);
          continue;
        }

        const definitionId = randomUUID();
        definitionIdMap.set(definition.id, definitionId);
        definitionTypeMap.set(definition.id, definition.type);

        const options = (definition.options ?? []).map((option) => {
          const existingOptionId = optionIdMap.get(option.id);

          if (existingOptionId) {
            return {
              id: existingOptionId,
              label: option.label,
              value: option.value,
              color: option.color,
              index: option.index,
            };
          }

          const optionId = randomUUID();
          optionIdMap.set(option.id, optionId);
          return {
            id: optionId,
            label: option.label,
            value: option.value,
            color: option.color,
            index: option.index,
          };
        });

        output.propertyDefinitions.push({
          id: definitionId,
          externalId: definition.id,
          name: definition.name,
          description: definition.description ?? null,
          type: definition.type,
          options,
        });
      }
    }

    function mapCollectionPropertyDefinitions(
      definitions: CollectionPropertyDefinitionJSONExport[],
      collectionId: string
    ) {
      for (const definition of definitions) {
        const mappedPropertyDefinitionId =
          definitionIdMap.get(definition.propertyDefinitionId);

        if (!mappedPropertyDefinitionId) {
          throw new Error(
            `Missing property definition for collection property ${definition.id}`
          );
        }

        output.collectionPropertyDefinitions.push({
          id: randomUUID(),
          externalId: definition.id,
          collectionId,
          propertyDefinitionId: mappedPropertyDefinitionId,
          state: definition.state as CollectionPropertyDefinitionState,
          required: definition.required,
          inheritToChildren: definition.inheritToChildren,
          index: definition.index ?? null,
        });
      }
    }

    function mapAttachments(attachments: {
      [id: string]: AttachmentJSONExport;
    }) {
      Object.values(attachments).forEach((node) => {
        const id = randomUUID();
        const mimeType = mime.lookup(node.key) || "application/octet-stream";
        const filePath = path.join(rootPath, node.key);

        // Block path traversal attempts
        if (node.key.includes("..")) {
          throw new Error(`Invalid attachment path: ${node.key}`);
        }

        const resolvedPath = path.resolve(filePath);
        if (!resolvedPath.startsWith(path.resolve(rootPath) + path.sep)) {
          throw new Error(`Invalid attachment path: ${node.key}`);
        }

        output.attachments.push({
          id,
          name: node.name,
          buffer: () => fs.readFile(filePath),
          mimeType,
          path: node.key,
          externalId: node.id,
        });
      });
    }

    // All nodes in the root level should be collections as JSON + metadata
    for (const node of tree) {
      if (node.children.length > 0 || node.path.endsWith("metadata.json")) {
        continue;
      }

      let item: CollectionJSONExport;
      try {
        item = JSON.parse(await fs.readFile(node.path, "utf8"));
      } catch (err) {
        throw new Error(`Could not parse ${node.path}. ${err.message}`);
      }

      const collectionId = randomUUID();

      output.collections.push({
        ...item.collection,
        id: collectionId,
        externalId: item.collection.id,
      });

      mapPropertyDefinitions(item.propertyDefinitions);
      mapCollectionPropertyDefinitions(
        item.collectionPropertyDefinitions,
        collectionId
      );

      if (Object.values(item.documents).length) {
        mapDocuments(item.documents, collectionId);
      }

      if (Object.values(item.attachments).length) {
        await mapAttachments(item.attachments);
      }
    }

    if (unmatchedUserEmails.size > 0) {
      Logger.warn("Dropped unmatched user property emails during JSON import", {
        fileOperationId: fileOperation.id,
        teamId: fileOperation.teamId,
        count: unmatchedUserEmails.size,
        emails: Array.from(unmatchedUserEmails),
      });
    }

    // Check all of the attachments we've created against urls and
    // replace them with the correct redirect urls before continuing.
    if (output.attachments.length) {
      this.replaceAttachmentURLs(output);
    }

    return output;
  }

  private replaceAttachmentURLs(output: StructuredImportData) {
    const attachmentTypes = ["attachment", "image", "video"];
    const urlRegex = /\/api\/attachments.redirect\?id=(.+)/;

    const attachmentExternalIdMap = output.attachments.reduce(
      (obj, attachment) => {
        if (attachment.externalId) {
          obj[attachment.externalId] = attachment;
        }
        return obj;
      },
      {} as Record<string, StructuredImportData["attachments"][number]>
    );

    const getRedirectPath = (existingPath?: string): string | undefined => {
      if (!existingPath) {
        return;
      }

      const match = existingPath.match(urlRegex);
      if (!match) {
        return existingPath;
      }

      const attachment = attachmentExternalIdMap[match[1]];
      // maintain the existing behaviour of using existingPath when attachment id is not present.
      return attachment
        ? Attachment.getRedirectUrl(attachment.id)
        : existingPath;
    };

    const transformAttachmentNode = (node: Node): Node => {
      const json = node.toJSON() as ProsemirrorData;
      const attrs = json.attrs ?? {};

      if (node.type.name === "attachment") {
        // attachment node uses 'href' attribute
        attrs.href = getRedirectPath(attrs.href as string);
      } else if (node.type.name === "image" || node.type.name === "video") {
        // image & video nodes use 'src' attribute
        attrs.src = getRedirectPath(attrs.src as string);
      }

      json.attrs = attrs;
      return Node.fromJSON(schema, json);
    };

    const transformFragment = (fragment: Fragment): Fragment => {
      const nodes: Node[] = [];

      fragment.forEach((node) => {
        nodes.push(
          attachmentTypes.includes(node.type.name)
            ? transformAttachmentNode(node)
            : node.copy(transformFragment(node.content))
        );
      });

      return Fragment.fromArray(nodes);
    };

    for (const collection of output.collections) {
      const node = Node.fromJSON(schema, collection.data);
      const transformedNode = node.copy(transformFragment(node.content));
      collection.description = serializer.serialize(transformedNode);
      collection.data = transformedNode.toJSON();
    }

    for (const document of output.documents) {
      const node = Node.fromJSON(schema, document.data);
      const transformedNode = node.copy(transformFragment(node.content));
      document.data = transformedNode.toJSON();
      document.text = serializer.serialize(transformedNode);
    }
  }

  private async loadUserIdByEmail(teamId: string) {
    const users = await User.findAll({
      attributes: ["id", "email"],
      where: {
        teamId,
      },
    });

    return users.reduce((map, user) => {
      if (user.email) {
        map.set(user.email.toLowerCase(), user.id);
      }

      return map;
    }, new Map<string, string>());
  }
}

function mapUserPropertyValue(
  rawValue: unknown,
  userIdByEmail: Map<string, string>,
  unmatchedUserEmails: Set<string>
) {
  const emails = Array.isArray(rawValue)
    ? rawValue
    : typeof rawValue === "string"
      ? [rawValue]
      : rawValue;

  if (!Array.isArray(emails)) {
    return rawValue;
  }

  return emails.flatMap((value) => {
    if (typeof value !== "string") {
      return [];
    }

    const userId = userIdByEmail.get(value.toLowerCase());
    if (!userId) {
      unmatchedUserEmails.add(value);
      return [];
    }

    return [userId];
  });
}
