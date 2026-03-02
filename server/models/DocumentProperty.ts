import type { InferAttributes, InferCreationAttributes } from "sequelize";
import type { JSONValue } from "@shared/types";
import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Table,
} from "sequelize-typescript";
import Document from "./Document";
import PropertyDefinition from "./PropertyDefinition";
import Team from "./Team";
import User from "./User";
import IdModel from "./base/IdModel";
import Fix from "./decorators/Fix";

@Table({ tableName: "document_properties", modelName: "document_property" })
@Fix
class DocumentProperty extends IdModel<
  InferAttributes<DocumentProperty>,
  Partial<InferCreationAttributes<DocumentProperty>>
> {
  @Column(DataType.JSONB)
  value: JSONValue | null;

  @BelongsTo(() => Document, "documentId")
  document: Document;

  @ForeignKey(() => Document)
  @Column(DataType.UUID)
  documentId: string;

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

export default DocumentProperty;
