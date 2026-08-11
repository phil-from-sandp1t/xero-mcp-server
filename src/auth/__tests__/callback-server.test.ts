import http from "node:http";
import net from "node:net";

import { describe, expect, it } from "vitest";

import { CALLBACK_HOST, awaitCallback } from "../pkce.js";
import { browserCommand } from "../open-browser.js";

/** A free port, so tests never collide with a real auth flow on 3333. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, CALLBACK_HOST, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: CALLBACK_HOST, port, path }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
  });
}

/** Yield a tick so the server is listening before the first request. */
const listening = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("awaitCallback", () => {
  it("resolves with the code from a matching callback", async () => {
    const port = await freePort();
    const pending = awaitCallback(port, "state-1", () => {});
    await listening();

    const res = await get(port, "/callback?state=state-1&code=the-code");

    expect(res.status).toBe(200);
    await expect(pending).resolves.toEqual({ code: "the-code" });
  });

  it("survives a state mismatch instead of cancelling the login in progress", async () => {
    const port = await freePort();
    const pending = awaitCallback(port, "state-1", () => {});
    await listening();

    // A stray or hostile request must not end the user's flow.
    const rejected = await get(port, "/callback?state=wrong&code=attacker-code");
    expect(rejected.status).toBe(400);

    // The listener is still up, and the genuine callback still works.
    const accepted = await get(port, "/callback?state=state-1&code=real-code");
    expect(accepted.status).toBe(200);
    await expect(pending).resolves.toEqual({ code: "real-code" });
  });

  it("keeps waiting when a callback carries no code", async () => {
    const port = await freePort();
    const pending = awaitCallback(port, "state-1", () => {});
    await listening();

    expect((await get(port, "/callback?state=state-1")).status).toBe(400);
    expect((await get(port, "/callback?state=state-1&code=eventually")).status).toBe(200);
    await expect(pending).resolves.toEqual({ code: "eventually" });
  });

  it("rejects when Xero itself reports an error, which does end the flow", async () => {
    const port = await freePort();
    const pending = awaitCallback(port, "state-1", () => {});
    // Attach the rejection handler before provoking it, or the rejection is
    // briefly unhandled and Node reports it.
    const rejects = expect(pending).rejects.toThrow(/access_denied/);
    await listening();

    const res = await get(port, "/callback?error=access_denied&error_description=nope");

    expect(res.status).toBe(400);
    await rejects;
  });

  it("ignores paths other than the redirect URI", async () => {
    const port = await freePort();
    const pending = awaitCallback(port, "state-1", () => {});
    await listening();

    expect((await get(port, "/")).status).toBe(404);

    await get(port, "/callback?state=state-1&code=done");
    await expect(pending).resolves.toEqual({ code: "done" });
  });

  it("binds loopback only, so the listener is not reachable from the network", async () => {
    const port = await freePort();
    let bound: net.AddressInfo | string | null | undefined;
    const pending = awaitCallback(port, "state-1", (address) => {
      bound = address;
    });
    await listening();

    // Assert the address actually bound. Probing by binding the wildcard
    // address instead would be a platform test, not a behaviour one: BSD lets
    // 0.0.0.0 coexist with a bound 127.0.0.1, Linux does not.
    expect(bound).toMatchObject({ address: CALLBACK_HOST });

    await get(port, "/callback?state=state-1&code=cleanup");
    await pending;
  });
});

describe("browserCommand", () => {
  it("uses cmd /c start on Windows, since start is a shell built-in", () => {
    const { command, args } = browserCommand("win32", "https://example.com");

    expect(command).toBe("cmd");
    // The empty title argument matters: without it start treats the URL as the
    // window title and opens nothing.
    expect(args).toEqual(["/c", "start", "", "https://example.com"]);
  });

  it("uses the native opener on macOS and Linux", () => {
    expect(browserCommand("darwin", "https://example.com")).toEqual({
      command: "open",
      args: ["https://example.com"],
    });
    expect(browserCommand("linux", "https://example.com")).toEqual({
      command: "xdg-open",
      args: ["https://example.com"],
    });
  });
});
