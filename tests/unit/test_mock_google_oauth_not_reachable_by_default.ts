import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * research.md #2, mitigation 2: the only remaining gate for the mocked
 * Google OAuth boundary that is real, shipped production code is
 * authConfig.ts's choice of which provider to register. This is a static,
 * source-shape check (in the spirit of test_community_creation_not_networked.ts)
 * confirming every reference to GOOGLE_OAUTH_MOCK_URL, or to constructing the
 * mock provider, is textually nested inside a branch conditioned on
 * GOOGLE_OAUTH_MOCK_ENABLED — kept alongside the behavioral guard
 * (test_auth_google_provider_selection.ts), not instead of it: a guard can be
 * present and wrong, which only the behavioral test can catch, but it can
 * also be entirely absent from an unrelated code path, which only a
 * structural check like this one can catch.
 */

const AUTH_CONFIG_PATH = path.resolve(__dirname, "../../src/lib/auth/authConfig.ts");

function isGuardedByMockEnabledCheck(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isIfStatement(current) && current.expression.getText().includes("GOOGLE_OAUTH_MOCK_ENABLED")) {
      return true;
    }
    if (
      (ts.isConditionalExpression(current) || ts.isBinaryExpression(current)) &&
      current.getText().includes("GOOGLE_OAUTH_MOCK_ENABLED")
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

describe("the mock Google OAuth boundary is not reachable by default (research.md #2)", () => {
  it("every reference to GOOGLE_OAUTH_MOCK_URL in authConfig.ts is nested inside a GOOGLE_OAUTH_MOCK_ENABLED-conditioned branch", () => {
    const sourceText = fs.readFileSync(AUTH_CONFIG_PATH, "utf8");
    const sourceFile = ts.createSourceFile(AUTH_CONFIG_PATH, sourceText, ts.ScriptTarget.Latest, true);

    const referencesFound: ts.Node[] = [];
    function visit(node: ts.Node) {
      if (ts.isIdentifier(node) && node.text === "GOOGLE_OAUTH_MOCK_URL") {
        referencesFound.push(node);
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    expect(referencesFound.length).toBeGreaterThan(0);
    for (const reference of referencesFound) {
      expect(isGuardedByMockEnabledCheck(reference.parent)).toBe(true);
    }
  });
});
