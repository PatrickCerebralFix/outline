import type { Context, Next } from "koa";
import Router from "koa-router";
import { randomString } from "@shared/random";
import { UserRole } from "@shared/types";
import type { Invite } from "@server/commands/userInviter";
import userInviter from "@server/commands/userInviter";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import { presentUser } from "@server/presenters";
import type { APIContext } from "@server/types";
import * as T from "./schema";

const router = new Router();

function dev() {
  return async function checkDevelopmentMiddleware(ctx: Context, next: Next) {
    if (env.ENVIRONMENT !== "development") {
      throw new Error("Attempted to access development route in production");
    }

    return next();
  };
}

router.post(
  "developer.create_test_users",
  dev(),
  auth(),
  validate(T.CreateTestUsersSchema),
  async (ctx: APIContext<T.CreateTestUsersReq>) => {
    const { count = 10 } = ctx.input.body;
    const invites = Array(Math.min(count, 100))
      .fill(0)
      .map(() => {
        const rando = randomString(10);

        return {
          email: `${rando}@example.com`,
          name: `${rando.slice(0, 5)} Tester`,
          role: UserRole.Member,
        };
      });

    Logger.info("utils", `Creating ${count} test users`, invites);

    // Generate a bunch of invites
    const response = await userInviter(ctx, { invites });

    // Convert from invites to active users by marking as active
    await Promise.all(
      response.users.map((user) => user.updateActiveAt(ctx, true))
    );

    ctx.body = {
      data: {
        users: response.users.map((user) => presentUser(user)),
      },
    };
  }
);

router.post(
  "developer.create_test_user",
  dev(),
  auth(),
  validate(T.CreateTestUserSchema),
  async (ctx: APIContext<T.CreateTestUserReq>) => {
    const rando = randomString(10);
    const invites: Invite[] = [
      {
        email: `${rando}@example.com`,
        name: `${rando.slice(0, 5)} Tester`,
        role: UserRole.Member,
      },
    ];

    const response = await userInviter(ctx, { invites });
    const newUser = response.users[0];
    await newUser.updateActiveAt(ctx, true);

    const signinUrl = `${env.URL}/auth/email.callback?token=${newUser.getEmailSigninToken(ctx)}`;

    ctx.body = {
      data: {
        user: presentUser(newUser),
        signinUrl,
      },
    };
  }
);

export default router;
