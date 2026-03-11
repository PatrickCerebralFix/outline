import invariant from "invariant";
import { action, runInAction } from "mobx";
import type RootStore from "~/stores/RootStore";
import PropertyDefinition from "~/models/PropertyDefinition";
import { client } from "~/utils/ApiClient";
import Store from "./base/Store";

export default class PropertyDefinitionsStore extends Store<PropertyDefinition> {
  private request: Promise<PropertyDefinition[]> | null = null;

  constructor(rootStore: RootStore) {
    super(rootStore, PropertyDefinition);
  }

  @action
  fetchDefinitions = async (): Promise<PropertyDefinition[]> => {
    if (this.request) {
      return this.request;
    }

    this.request = client
      .post("/propertyDefinitions.list", {})
      .then((res) => {
        invariant(res?.data, "Property definitions list not available");

        return runInAction("PropertyDefinitionsStore#fetchDefinitions", () => {
          res.data.forEach(this.add);
          this.addPolicies(res.policies);
          return res.data.map((item: { id: string }) => this.get(item.id)!);
        });
      })
      .finally(() => {
        this.request = null;
      });

    return this.request;
  };
}
