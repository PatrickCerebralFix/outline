import type { InferAttributes, InferCreationAttributes } from "sequelize";
import { DocumentPropertyType } from "@shared/types";
import {
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  HasMany,
  IsIn,
  Table,
  Length as SimpleLength,
} from "sequelize-typescript";
import Collection from "./Collection";
import DocumentProperty from "./DocumentProperty";
import Team from "./Team";
import User from "./User";
import ParanoidModel from "./base/ParanoidModel";
import Fix from "./decorators/Fix";
import PropertyDefinitionOption from "./PropertyDefinitionOption";

@Table({ tableName: "property_definitions", modelName: "property_definition" })
@Fix
class PropertyDefinition extends ParanoidModel<
  InferAttributes<PropertyDefinition>,
  Partial<InferCreationAttributes<PropertyDefinition>>
> {
  @SimpleLength({
    max: 255,
    msg: "name must be 255 characters or less",
  })
  @Column(DataType.STRING)
  name: string;

  @SimpleLength({
    max: 2000,
    msg: "description must be 2000 characters or less",
  })
  @Column(DataType.TEXT)
  description: string | null;

  @IsIn([Object.values(DocumentPropertyType)])
  @Column(DataType.STRING)
  type: DocumentPropertyType;

  @Default(false)
  @Column(DataType.BOOLEAN)
  required: boolean;

  @BelongsTo(() => Collection, "collectionId")
  collection: Collection;

  @ForeignKey(() => Collection)
  @Column(DataType.UUID)
  collectionId: string;

  @BelongsTo(() => Team, "teamId")
  team: Team;

  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  @BelongsTo(() => User, "createdById")
  createdBy: User;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  createdById: string;

  @BelongsTo(() => User, "lastModifiedById")
  updatedBy: User;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  lastModifiedById: string;

  @HasMany(() => PropertyDefinitionOption)
  options: PropertyDefinitionOption[];

  @HasMany(() => DocumentProperty)
  documentProperties: DocumentProperty[];
}

export default PropertyDefinition;
