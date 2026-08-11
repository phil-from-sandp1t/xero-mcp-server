import { execFile } from "node:child_process";

export interface BrowserCommand {
  command: string;
  args: string[];
}

/**
 * How to open a URL on each platform.
 *
 * Windows needs `cmd /c start` rather than `start`: `start` is a cmd.exe
 * built-in, not an executable, so spawning it directly fails with ENOENT. The
 * empty string after it is the window title — without it, `start` treats the
 * URL as the title and opens nothing.
 */
export function browserCommand(platform: NodeJS.Platform, url: string): BrowserCommand {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

/**
 * Best-effort browser launch. Never rejects: callers always print the URL too,
 * so a headless or locked-down machine degrades to copy-and-paste rather than
 * failing the flow.
 */
export function openBrowser(url: string): void {
  const { command, args } = browserCommand(process.platform, url);

  execFile(command, args, () => {
    /* ignored: the URL is always surfaced to the user as well */
  });
}
