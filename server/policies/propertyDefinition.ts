import { PropertyDefinition, User } from "@server/models";
import { allow } from "./cancan";
import { and, isTeamAdmin, isTeamModel } from "./utils";

allow(User, "read", PropertyDefinition, (actor, definition) =>
  definition ? and(isTeamModel(actor, definition)) : false
);

allow(User, "update", PropertyDefinition, (actor, definition) =>
  definition ? and(isTeamModel(actor, definition), isTeamAdmin(actor, definition)) : false
);

allow(User, "delete", PropertyDefinition, (actor, definition) =>
  definition ? and(isTeamModel(actor, definition), isTeamAdmin(actor, definition)) : false
);
