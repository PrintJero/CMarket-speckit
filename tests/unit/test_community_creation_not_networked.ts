import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * FR-002: community creation tooling MUST NOT be reachable over the network
 * from the user-facing application, with the sole, disabled-by-default
 * exception recorded in FR-016 (plan.md Complexity Tracking). This walks the
 * *actual* static import graph reachable from every file under app/
 * (following import/export re-exports, resolving the @/* tsconfig alias)
 * rather than doing a text search — a text search would miss an indirect
 * import through a barrel/index module and would false-positive on a
 * comment that merely mentions the module's name.
 *
 * Residual gap (Principle VII, disclosed rather than silently missing): this
 * only resolves statically analyzable `import`/`export ... from` specifiers.
 * A dynamic import with a computed, non-literal specifier (e.g.
 * `await import(someVariable)`) is not resolved and would not be caught. A
 * full dynamic-import-aware, bundler-grade analysis was judged
 * disproportionate for this feature.
 */

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(PROJECT_ROOT, "app");
const FORBIDDEN_TARGET = path.normalize(
  path.join(PROJECT_ROOT, "src", "server", "services", "communityService.ts"),
);

/** FR-016: the sole allow-listed exception — the dev-only operator panel's route handler. */
const ALLOWED_REACHERS = new Set([
  path.normalize(path.join(APP_DIR, "api", "operator", "create-community", "route.ts")),
]);

function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFilesRecursive(fullPath);
    if (/\.(ts|tsx)$/.test(entry.name)) return [fullPath];
    return [];
  });
}

const specifierCache = new Map<string, string[]>();

function extractModuleSpecifiers(filePath: string): string[] {
  const cached = specifierCache.get(filePath);
  if (cached) return cached;

  const sourceText = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  sourceFile.forEachChild((node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
  });
  specifierCache.set(filePath, specifiers);
  return specifiers;
}

/** Resolves a relative or `@/*`-aliased specifier to a real file path. Returns null for external packages (not part of this repo's own import graph). */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let target: string;
  if (specifier.startsWith(".")) {
    target = path.resolve(path.dirname(fromFile), specifier);
  } else if (specifier.startsWith("@/")) {
    target = path.join(PROJECT_ROOT, "src", specifier.slice(2));
  } else {
    return null;
  }

  const candidates = [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    path.join(target, "index.ts"),
    path.join(target, "index.tsx"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  return found ? path.normalize(found) : null;
}

/** Whether communityService is reachable, directly or transitively, starting from `root`. */
function reachesForbiddenTarget(root: string): boolean {
  const visited = new Set<string>();
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (current === FORBIDDEN_TARGET) return true;

    for (const specifier of extractModuleSpecifiers(current)) {
      const resolved = resolveSpecifier(specifier, current);
      if (resolved && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }
  return false;
}

describe("community creation tooling is not reachable from app/ (FR-002, FR-016)", () => {
  it("only the allow-listed operator route reaches communityService — no other file under app/ does", () => {
    const appFiles = listFilesRecursive(APP_DIR).map((file) => path.normalize(file));
    const reachers = new Set(appFiles.filter((file) => reachesForbiddenTarget(file)));

    expect(reachers).toEqual(ALLOWED_REACHERS);
  });
});
