export const MASTER_SESSION_COOKIE_NAME = "cmarket_master_session";

export const masterSessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};
