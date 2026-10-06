// The load test's exit verdict, apart from the harness so a unit test can import it
// (load-test.mjs reads .env and signs in at import). Guard: src/test/loadTestVerdict.test.ts.
/**
 * Null when the run measured what it claims; else why it did not. An abort, a
 * run whose every message write was refused, or writes that landed but never
 * reached a subscriber are failures, never a green run (2026-10-06: 4/4 sends
 * refused per step and the job still exited 0).
 */
export function loadVerdict(result) {
  if (result.abortReason) return `aborted: ${result.abortReason}`;
  const sends = result.sends ?? [];
  const ok = sends.filter((x) => x.status >= 200 && x.status < 300);
  if (sends.length && !ok.length) {
    return `every message write was refused (${[...new Set(sends.map((x) => x.status))].join(", ")}): writes and realtime delivery were NOT measured`;
  }
  const delivered = (result.steps ?? []).reduce((n, st) => n + (st.realtime?.msgEvents ?? 0), 0);
  if (ok.length && !delivered) return `${ok.length} message(s) landed but no subscriber received one: realtime delivery is broken or unmeasured`;
  return null;
}
