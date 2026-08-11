/**
 * Run an async operation at most once at a time.
 *
 * Callers arriving while it is running share the in-progress result rather
 * than starting their own. Used for token refresh, where two concurrent
 * refreshes send the same refresh token twice: Xero rotates on first use, so
 * the second is rejected as invalid_grant and looks like a dead credential
 * when nothing is wrong.
 */
export function singleFlight<T>(operation: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | undefined;

  return () => {
    if (inFlight) return inFlight;

    // Cleared in a finally so a failure does not wedge every later call into
    // replaying the same rejection.
    inFlight = operation().finally(() => {
      inFlight = undefined;
    });

    return inFlight;
  };
}
