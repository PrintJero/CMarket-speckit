import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/passwordHash";
import { uniqueEmail } from "./helpers";

/** quickstart.md Scenario 3, step 3 / FR-010. */
test("wrong password and unknown email return the identical generic error", async ({
  request,
}) => {
  const email = uniqueEmail("signin-invalid");
  await prisma.account.create({
    data: {
      email,
      passwordHash: await hashPassword("the-real-password-123"),
      emailVerifiedAt: new Date(),
    },
  });

  const wrongPassword = await request.post("/api/auth/sign-in", {
    data: { email, password: "totally-wrong-password" },
  });
  const unknownEmail = await request.post("/api/auth/sign-in", {
    data: { email: uniqueEmail("no-such-account"), password: "whatever-password" },
  });

  expect(wrongPassword.status()).toBe(401);
  expect(unknownEmail.status()).toBe(401);
  expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
});
