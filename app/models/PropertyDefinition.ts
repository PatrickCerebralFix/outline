import { observable } from "mobx";
import type { DocumentPropertyType } from "@shared/types";
import ParanoidModel from "~/models/base/ParanoidModel";
import Field from "~/models/decorators/Field";

export interface PropertyDefinitionOption {
  id?: string;
  label: string;
  value: string;
  color?: string | null;
  index?: string | null;
}

class PropertyDefinition extends ParanoidModel {
  static modelName = "PropertyDefinition";

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
  required: boolean;

  @Field
  @observable
  collectionId: string;

  @Field
  @observable.shallow
  options: PropertyDefinitionOption[] = [];
}

export default PropertyDefinition;
