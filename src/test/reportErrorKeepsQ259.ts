/**
 * Q259 under jsdom 31: a render-phase warning must still fail the render that caused it.
 *
 * setup.ts turns React's render-phase warnings into a throw. For "Cannot update a component while rendering a
 * different component" React 18 catches that throw, retries the render (the warning is deduplicated, so the retry
 * passes) and hands the first error to onRecoverableError. Its default is `reportError` when the global exists,
 * else console.error. jsdom 30 has no reportError, so the error reached console.error, setup.ts's hook threw again,
 * and render() threw. jsdom 31 adds window.reportError, which only fires a window "error" event, so the render
 * passed and the test with the bug passed with it (measured 11-15: renderPhaseWarningsFail red on 31.0.0).
 *
 * react-dom reads `reportError` ONCE, when it loads, so this runs as setup.ts's first import, before
 * @testing-library/react loads react-dom. It rethrows only a Q259 error; every other report goes on as before.
 * Guard: src/test/renderPhaseWarningsFail.test.tsx.
 */
const g = globalThis as { reportError?: (e: unknown) => void };
const original = g.reportError;
if (typeof original === "function") {
  g.reportError = (e: unknown) => {
    if (e instanceof Error && e.message.startsWith("React render-phase warning (Q259)")) throw e;
    original.call(globalThis, e);
  };
}

export {};
