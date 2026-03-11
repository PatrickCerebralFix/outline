import type { InferAttributes, InferCreationAttributes } from "sequelize";
import { CollectionPropertyDefinitionState } from "@shared/types";
import {
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  IsIn,
  Table,
} from "sequelize-typescript";
import Collection from "./Collection";
import PropertyDefinition from "./PropertyDefinition";
import Team from "./Team";
import User from "./User";
import ParanoidModel from "./base/ParanoidModel";
import Fix from "./decorators/Fix";

@Table({
  tableName: "collection_property_definitions",
  modelName: "collection_property_definition",
})
@Fix
class CollectionPropertyDefinition extends ParanoidModel<
  InferAttributes<CollectionPropertyDefinition>,
  Partial<InferCreationAttributes<CollectionPropertyDefinition>>
> {
  @IsIn([Object.values(CollectionPropertyDefinitionState)])
  @Column(DataType.STRING)
  state: CollectionPropertyDefinitionState;

  @Column(DataType.BOOLEAN)
  required: boolean;

  @Default(true)
  @Column(DataType.BOOLEAN)
  inheritToChildren: boolean;

  @Column(DataType.STRING)
  index: string | null;

  @BelongsTo(() => Collection, "collectionId")
  collection: Collection;

  @ForeignKey(() => Collection)
  @Column(DataType.UUID)
  collectionId: string;

  @BelongsTo(() => PropertyDefinition, "propertyDefinitionId")
  propertyDefinition: PropertyDefinition;

  @ForeignKey(() => PropertyDefinition)
  @Column(DataType.UUID)
  propertyDefinitionId: string;

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
}

export default CollectionPropertyDefinition;
