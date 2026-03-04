import stores from "~/stores";

describe("Document model", () => {
  test("should preserve properties from payload", () => {
    const document = stores.documents.add({
      id: "doc-model-preserve-properties",
      title: "Test document",
      properties: {
        rarity: ["rare"],
      },
    });

    expect(document.properties).toEqual({
      rarity: ["rare"],
    });
  });

  test("should default properties to an empty object", () => {
    const document = stores.documents.add({
      id: "doc-model-default-properties",
      title: "Document without properties",
    });

    expect(document.properties).toEqual({});
  });
});
