import { DocumentPropertyType } from "@shared/types";
import { toJS } from "mobx";
import stores from "~/stores";

describe("PropertyDefinition model", () => {
  test("should preserve options from payload", () => {
    const definition = stores.propertyDefinitions.add({
      id: "property-definition-preserve-options",
      name: "Rarity",
      description: null,
      type: DocumentPropertyType.MultiSelect,
      options: [
        {
          id: "property-option-rare",
          label: "Rare",
          value: "Rare",
          color: "#f5ca5b",
        },
      ],
    });

    expect(toJS(definition.options)).toEqual([
      {
        id: "property-option-rare",
        label: "Rare",
        value: "Rare",
        color: "#f5ca5b",
      },
    ]);
  });

  test("should default options to an empty array", () => {
    const definition = stores.propertyDefinitions.add({
      id: "property-definition-default-options",
      name: "Health",
      description: null,
      type: DocumentPropertyType.Number,
    });

    expect(toJS(definition.options)).toEqual([]);
  });
});
