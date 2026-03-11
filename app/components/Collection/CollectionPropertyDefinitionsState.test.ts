import { DocumentPropertyType } from "@shared/types";
import {
  createPreviousIndex,
  deriveCollectionPropertyDefinitionsState,
  removeDraftRow,
  toDraftRows,
  upsertDraftRow,
  type CollectionPropertyDefinitionsSnapshot,
} from "./CollectionPropertyDefinitionsState";

describe("CollectionPropertyDefinitionsState", () => {
  const collectionId = "child-collection";
  const parentId = "parent-collection";
  const propertyDefinitionId = "definition-1";
  const definition = {
    id: propertyDefinitionId,
    name: "Status",
    type: DocumentPropertyType.Text,
  };

  it("keeps an overwritten property hidden and restorable within one deferred session", () => {
    const snapshot: CollectionPropertyDefinitionsSnapshot = {
      effective: [
        {
          id: "local-row",
          collectionId,
          propertyDefinitionId,
          sourceCollectionId: collectionId,
          sourceCollectionName: "Child",
          state: "attached",
          required: false,
          inheritToChildren: true,
          index: "b0",
          isInherited: false,
          isCustomized: true,
          isOverwritten: true,
          shadowed: {
            sourceCollectionId: parentId,
            sourceCollectionName: "Parent",
            required: true,
            inheritToChildren: true,
            index: "a0",
          },
          definition,
        },
      ],
      hidden: [],
      local: [
        {
          id: "local-row",
          collectionId,
          propertyDefinitionId,
          sourceCollectionId: collectionId,
          sourceCollectionName: "Child",
          state: "attached",
          required: false,
          inheritToChildren: true,
          index: "b0",
          isInherited: false,
          isCustomized: true,
          isOverwritten: true,
          shadowed: {
            sourceCollectionId: parentId,
            sourceCollectionName: "Parent",
            required: true,
            inheritToChildren: true,
            index: "a0",
          },
          definition,
        },
      ],
      available: [],
    };

    const hiddenDraftRows = upsertDraftRow(toDraftRows(snapshot.local), {
      propertyDefinitionId,
      state: "excluded",
      required: false,
      inheritToChildren: false,
      index: null,
    });

    const hiddenState = deriveCollectionPropertyDefinitionsState({
      snapshot,
      draftRows: hiddenDraftRows,
      collectionId,
    });
    expect(hiddenState.hidden).toEqual([
      expect.objectContaining({
        propertyDefinitionId,
        status: "hidden",
        sourceCollectionId: parentId,
        sourceCollectionName: "Parent",
      }),
    ]);

    const restoredState = deriveCollectionPropertyDefinitionsState({
      snapshot,
      draftRows: removeDraftRow(hiddenDraftRows, propertyDefinitionId),
      collectionId,
    });
    expect(restoredState.effective).toEqual([
      expect.objectContaining({
        propertyDefinitionId,
        status: "inherited",
        sourceCollectionId: parentId,
        sourceCollectionName: "Parent",
        required: true,
      }),
    ]);
  });

  it("creates an index before the first visible property for new additions", () => {
    const nextIndex = createPreviousIndex([
      {
        propertyDefinitionId: "first",
        definition,
        status: "direct",
        sourceCollectionId: collectionId,
        required: false,
        inheritToChildren: true,
        index: "b0",
      },
    ]);

    expect(nextIndex).not.toBe("b0");
    expect([nextIndex, "b0"].sort()).toEqual([nextIndex, "b0"]);
  });
});
