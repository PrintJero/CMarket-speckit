import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * FR-007: the bootstrap path (masterAuthService's createMaster, invoked with
 * createdByMasterId: null by scripts/bootstrap-master.ts) MUST NOT be
 * reachable from any user-facing route under app/ — mirrors
 * test_community_creation_not_networked.ts's static-import-graph approach
 * exactly, but with no allow-listed exception at all (unlike community
 * creation's dev-only operator panel, the bootstrap path has none — an
 * authenticated MASTER creates further MASTERs through masterAuthService's
 * createMaster() called with a non-null createdByMasterId, from
 * app/api/master/masters/route.ts, which is a *different*, legitimate call
 * site — this test only forbids app/ from importing
 * scripts/bootstrap-master.ts itself).
 */

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(PROJECT_ROOT, "app");
const FORBIDDEN_TARGET = path.normalize(path.join(PROJECT_ROOT, "scripts", "bootstrap-master.ts"));

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

describe("the bootstrap script is not reachable from app/ (FR-007)", () => {
  it("no file under app/ imports scripts/bootstrap-master.ts, directly or transitively", () => {
    const appFiles = listFilesRecursive(APP_DIR).map((file) => path.normalize(file));
    const reachers = new Set(appFiles.filter((file) => reachesForbiddenTarget(file)));

    expect(reachers).toEqual(new Set());
  });
});
