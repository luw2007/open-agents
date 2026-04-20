import { cookies } from "next/headers";
import type { Session } from "./types";
import { SESSION_COOKIE_NAME } from "./constants";
import { getSessionFromCookie } from "./server";
import { cache } from "react";

const DEV_MOCK_SESSION: Session = {
  created: Date.now(),
  authProvider: "gitlab",
  user: {
    id: "dev-local-user",
    username: "dev",
    email: "dev@localhost",
    avatar: "",
    name: "Local Dev",
  },
};

export const getServerSession = cache(async () => {
  // Dev bypass: skip auth for local UI preview
  if (process.env.DEV_BYPASS_AUTH === "true") {
    return DEV_MOCK_SESSION;
  }

  const store = await cookies();
  const cookieValue = store.get(SESSION_COOKIE_NAME)?.value;
  return getSessionFromCookie(cookieValue);
});
