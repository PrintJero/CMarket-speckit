import { expect, test } from "@playwright/test";
import { uniqueEmail } from "./helpers";

/** quickstart.md Scenario 2 / FR-009. */
test("repeating sign-up for the same email returns an identical response", async ({
  request,
}) => {
  const email = uniqueEmail("signup-enum");
  const password = "correct-horse-battery-staple";

  const first = await request.post("/api/auth/sign-up", { data: { email, password } });
  expect(first.status()).toBe(202);
  const firstBody = await first.json();

  const second = await request.post("/api/auth/sign-up", {
    data: { email, password: "a-different-valid-password" },
  });
  expect(second.status()).toBe(202);
  const secondBody = await second.json();

  expect(secondBody).toEqual(firstBody);
});
