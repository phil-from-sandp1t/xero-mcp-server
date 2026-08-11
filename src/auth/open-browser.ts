import { execFile } from "node:child_process";

/**
 * Best-effort browser launch. Never rejects: callers always print the URL too,
 * so a headless or locked-down machine degrades to copy-and-paste rather than
 * failing the flow.
 */
export function openBrowser(url: string): void {
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";

  execFile(opener, [url], () => {
    /* ignored: the URL is always surfaced to the user as well */
  });
}
