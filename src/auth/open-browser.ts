import { execFile } from "node:child_process";

export interface BrowserCommand {
  command: string;
  args: string[];
  /** Spawn options this command needs; only Windows requires any. */
  options?: { windowsVerbatimArguments?: boolean };
}

/**
 * How to open a URL on each platform.
 *
 * Windows needs `cmd /c start` rather than `start`: `start` is a cmd.exe
 * built-in, not an executable, so spawning it directly fails with ENOENT. The
 * empty string after it is the window title — without it, `start` treats the
 * URL as the title and opens nothing.
 *
 * The URL is quoted, and the arguments passed verbatim. An authorize URL
 * carries `&` between query parameters, and cmd.exe reads `&` as a command
 * separator: unquoted, it runs the tail of the URL as a second command and the
 * browser receives a truncated address. Node only quotes arguments containing
 * whitespace, so it will not do this for us — hence explicit quotes plus
 * windowsVerbatimArguments so they survive.
 */
export function browserCommand(platform: NodeJS.Platform, url: string): BrowserCommand {
  if (platform === "darwin") return { command: "open", args: [url] };

  if (platform === "win32") {
    return {
      command: "cmd",
      args: ["/c", "start", '""', `"${url}"`],
      options: { windowsVerbatimArguments: true },
    };
  }

  return { command: "xdg-open", args: [url] };
}

/**
 * Best-effort browser launch. Never rejects: callers always print the URL too,
 * so a headless or locked-down machine degrades to copy-and-paste rather than
 * failing the flow.
 */
export function openBrowser(url: string): void {
  const { command, args, options } = browserCommand(process.platform, url);

  execFile(command, args, { ...options }, () => {
    /* ignored: the URL is always surfaced to the user as well */
  });
}
