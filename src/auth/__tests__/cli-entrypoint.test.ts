import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * npm installs a bin as a symlink, so `npx xero-auth` runs the CLI with
 * argv[1] pointing at .bin/xero-auth rather than the real file. An entry-point
 * guard that compares those paths naively never matches, and the documented
 * command exits silently having done nothing at all.
 *
 * Runs the built CLI through a symlink, the way npm would. Requires dist,
 * which the package's `prepare` script builds on install.
 */
describe("xero-auth entry point", () => {
  const cli = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../dist/auth/cli.js",
  );

  it("runs when invoked through a symlinked bin", () => {
    expect(fs.existsSync(cli)).toBe(true);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xero-bin-"));
    const link = path.join(dir, "xero-auth");
    fs.symlinkSync(cli, link);

    // No client id and no token file: main() reaches config resolution and
    // exits non-zero with an explanation. Silence would mean it never ran.
    let stderr = "";
    let status = 0;
    try {
      execFileSync(process.execPath, [link], {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          XERO_TOKEN_FILE: path.join(dir, "absent-tokens.json"),
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      status = failure.status ?? 0;
      stderr = failure.stderr ?? "";
    }

    expect(status).toBe(1);
    expect(stderr).toMatch(/client id/i);
  });
});
