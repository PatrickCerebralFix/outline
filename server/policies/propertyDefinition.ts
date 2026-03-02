import { Collection, PropertyDefinition, User } from "@server/models";
import { allow, can } from "./cancan";
import { and, isTeamModel } from "./utils";

const canReadPropertyDefinition = (
  actor: User,
  definition: PropertyDefinition
) => {
  if (!definition.collection) {
    return false;
  }

  return and(
    isTeamModel(actor, definition),
    can(actor, "readDocument", definition.collection)
  );
};

const canUpdatePropertyDefinition = (
  actor: User,
  definition: PropertyDefinition
) => {
  if (!definition.collection) {
    return false;
  }

  return and(
    isTeamModel(actor, definition),
    can(actor, "updateDocument", definition.collection)
  );
};

allow(User, "createPropertyDefinition", Collection, (actor, collection) =>
  and(!!collection, can(actor, "updateDocument", collection))
);

allow(User, "read", PropertyDefinition, (actor, definition) =>
  definition ? canReadPropertyDefinition(actor, definition) : false
);

allow(User, "update", PropertyDefinition, (actor, definition) =>
  definition ? canUpdatePropertyDefinition(actor, definition) : false
);

allow(User, "delete", PropertyDefinition, (actor, definition) =>
  definition ? canUpdatePropertyDefinition(actor, definition) : false
);
