import { describe, expect, it, vi } from "vitest";

import { singleFlight } from "../single-flight.js";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("singleFlight", () => {
  it("runs once for callers that overlap, and gives them all the same result", async () => {
    const gate = deferred<string>();
    const operation = vi.fn(() => gate.promise);
    const guarded = singleFlight(operation);

    const [a, b, c] = [guarded(), guarded(), guarded()];
    gate.resolve("token");

    expect(await a).toBe("token");
    expect(await b).toBe("token");
    expect(await c).toBe("token");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("runs again once the previous run has settled", async () => {
    const operation = vi.fn(async () => "token");
    const guarded = singleFlight(operation);

    await guarded();
    await guarded();

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("gives every waiter the same failure", async () => {
    const gate = deferred<string>();
    const guarded = singleFlight(() => gate.promise);

    const a = guarded();
    const b = guarded();
    const expectations = Promise.all([
      expect(a).rejects.toThrow(/nope/),
      expect(b).rejects.toThrow(/nope/),
    ]);
    gate.reject(new Error("nope"));

    await expectations;
  });

  it("does not wedge later calls after a failure", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("token");
    const guarded = singleFlight(operation);

    await expect(guarded()).rejects.toThrow(/transient/);

    // A failed refresh must not make the next one replay the same rejection.
    await expect(guarded()).resolves.toBe("token");
  });
});
