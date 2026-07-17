import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const TSX_CLI = path.join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = path.join(PROJECT_ROOT, "scripts", "create-community.ts");

interface ScriptResult {
  status: number;
  output: string;
}

/** Invokes tsx's own CLI entry directly (no npx/shell) so argument quoting is exact cross-platform. */
function runScript(args: string[]): ScriptResult {
  try {
    const stdout = execFileSync(process.execPath, [TSX_CLI, SCRIPT, ...args], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const err = error as { status: number | null; stdout: string; stderr: string };
    return { status: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function createVerifiedAccount(email: string) {
  return prisma.account.create({
    data: { email, passwordHash: "irrelevant-hash", emailVerifiedAt: new Date() },
  });
}

function createUnverifiedAccount(email: string) {
  return prisma.account.create({ data: { email, passwordHash: null, emailVerifiedAt: null } });
}

describe("scripts/create-community.ts (CLI contract)", () => {
  beforeEach(async () => {
    await prisma.community.deleteMany({ where: { name: { contains: "CLI Test Community" } } });
    await prisma.account.deleteMany({ where: { email: { contains: "cli-community" } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // T010 (US1): happy path.
  it("exits 0 and prints id/name/createdAt for a valid, verified account", async () => {
    const founder = await createVerifiedAccount("cli-community-founder-1@example.com");

    const { status, output } = runScript([
      "--name",
      "CLI Test Community One",
      "--email",
      founder.email,
      "--operator",
      "test-operator",
    ]);

    expect(status).toBe(0);
    expect(output).toContain("CLI Test Community One");

    const community = await prisma.community.findFirst({ where: { name: "CLI Test Community One" } });
    expect(community).not.toBeNull();
    expect(output).toContain(community!.id);
  });

  // T012 (US2): specific, human-worded rejection — not the raw enum value.
  it("FR-003 wording: exits non-zero with a specific 'no account found' message for a nonexistent email", () => {
    const { status, output } = runScript([
      "--name",
      "CLI Test Community Two",
      "--email",
      "cli-community-nonexistent@example.com",
      "--operator",
      "test-operator",
    ]);

    expect(status).not.toBe(0);
    expect(output.toLowerCase()).toContain("no account found");
    expect(output).not.toContain("account_not_found");
  });

  // T014 (US3): specific, human-worded rejection, distinguishable from T012's, account unchanged.
  it("FR-004 wording: exits non-zero with a specific 'not verified' message, distinct from the not-found case, account unchanged", async () => {
    const before = await createUnverifiedAccount("cli-community-unverified@example.com");

    const { status, output } = runScript([
      "--name",
      "CLI Test Community Three",
      "--email",
      before.email,
      "--operator",
      "test-operator",
    ]);

    expect(status).not.toBe(0);
    expect(output.toLowerCase()).toContain("not verified");
    expect(output.toLowerCase()).not.toContain("no account found");
    expect(output).not.toContain("account_not_verified");

    const after = await prisma.account.findUnique({ where: { id: before.id } });
    expect(after).toEqual(before);
  });
});
