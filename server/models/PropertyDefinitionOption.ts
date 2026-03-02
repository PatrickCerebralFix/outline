import type { InferAttributes, InferCreationAttributes } from "sequelize";
import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Table,
  Length as SimpleLength,
} from "sequelize-typescript";
import Team from "./Team";
import User from "./User";
import ParanoidModel from "./base/ParanoidModel";
import Fix from "./decorators/Fix";
import PropertyDefinition from "./PropertyDefinition";

@Table({
  tableName: "property_definition_options",
  modelName: "property_definition_option",
})
@Fix
class PropertyDefinitionOption extends ParanoidModel<
  InferAttributes<PropertyDefinitionOption>,
  Partial<InferCreationAttributes<PropertyDefinitionOption>>
> {
  @SimpleLength({
    max: 255,
    msg: "label must be 255 characters or less",
  })
  @Column(DataType.STRING)
  label: string;

  @SimpleLength({
    max: 255,
    msg: "value must be 255 characters or less",
  })
  @Column(DataType.STRING)
  value: string;

  @Column(DataType.STRING)
  color: string | null;

  @SimpleLength({
    max: 255,
    msg: "index must be 255 characters or less",
  })
  @Column(DataType.STRING)
  index: string | null;

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

export default PropertyDefinitionOption;
