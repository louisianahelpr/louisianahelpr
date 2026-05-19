/**
 * Minimal `Deno` runtime stub + a registry for the request handler that an
 * edge function passes to `serve()`.
 *
 * The harness rewrites each function so `serve` becomes a thin call into
 * `__registerHandler`, and the `Deno` global becomes `__denoStub`. Tests set
 * env values via `setEnv()` before loading the function.
 */

let __handler: ((req: Request) => Response | Promise<Response>) | null = null;

/** Called by the harness-injected `serve` shim. */
export function __registerHandler(
  h: (req: Request) => Response | Promise<Response>,
) {
  __handler = h;
}

export function __getHandler() {
  return __handler;
}

export function __clearHandler() {
  __handler = null;
}

/** Backing store for `Deno.env.get`. */
let __env: Record<string, string> = {};

/**
 * Replace the entire env map the function-under-test sees. Call before
 * `loadEdgeFunction` for env read at module scope, or before `fetch` for
 * env read inside the handler.
 */
export function setEnv(env: Record<string, string>) {
  __env = { ...env };
}

export function resetEnv() {
  __env = {};
}

/** The object injected as the `Deno` global into the rewritten function. */
export const __denoStub = {
  env: {
    get: (key: string): string | undefined => __env[key],
    set: (key: string, value: string) => {
      __env[key] = value;
    },
    toObject: () => ({ ...__env }),
  },
};
