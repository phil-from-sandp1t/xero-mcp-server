import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const handlersDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every handler authenticates before its request, and in refresh-token mode
 * that call is what renews the access token and settles the organisation.
 * Dropping the await does not fail loudly — it races, and the request goes out
 * with a stale token or an unresolved tenant. Two handlers shipped that way
 * upstream, so this checks the whole set rather than the two that were found.
 */
describe("handlers", () => {
  it("always await xeroClient.authenticate()", () => {
    const offenders: string[] = [];

    for (const entry of fs.readdirSync(handlersDir)) {
      if (!entry.endsWith(".handler.ts")) continue;

      const source = fs.readFileSync(path.join(handlersDir, entry), "utf8");
      source.split("\n").forEach((line, index) => {
        if (!line.includes("xeroClient.authenticate()")) return;
        if (/await\s+xeroClient\.authenticate\(\)/.test(line)) return;
        offenders.push(`${entry}:${index + 1}`);
      });
    }

    expect(offenders).toEqual([]);
  });
});
