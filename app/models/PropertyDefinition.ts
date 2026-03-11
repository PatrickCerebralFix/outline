import { observable } from "mobx";
import type { DocumentPropertyType } from "@shared/types";
import ParanoidModel from "~/models/base/ParanoidModel";
import Field from "~/models/decorators/Field";
import type PropertyDefinitionsStore from "~/stores/PropertyDefinitionsStore";

export interface PropertyDefinitionOption {
  id?: string;
  label: string;
  value: string;
  color?: string | null;
  index?: string | null;
}

class PropertyDefinition extends ParanoidModel {
  static modelName = "PropertyDefinition";

  constructor(fields: Record<string, any>, store: PropertyDefinitionsStore) {
    super(fields, store);

    this.options = Array.isArray(fields.options) ? fields.options : [];
  }

  @Field
  @observable
  name: string;

  @Field
  @observable
  description: string | null;

  @Field
  @observable
  type: DocumentPropertyType;

  @Field
  @observable
  usageCount?: number;

  @Field
  @observable.shallow
  options: PropertyDefinitionOption[];
}

export default PropertyDefinition;
