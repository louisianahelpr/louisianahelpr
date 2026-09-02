// Type shim for `import Stripe from "https://esm.sh/stripe@18.5.0"`.
//
// USED ONLY BY `npm run typecheck:edge`, via the `imports` map in
// scripts/edge-typecheck.deno.json. Nothing ships this file; production keeps
// loading the esm.sh build unchanged.
//
// ── Why it has to exist ────────────────────────────────────────────────────
// esm.sh answers `https://esm.sh/stripe@18.5.0` with an `X-TypeScript-Types`
// header pointing at `https://esm.sh/stripe@18.5.0/types/index.d.ts`, so Deno
// dutifully downloads all ~450 Stripe `.d.ts` files. They then do nothing.
// Stripe ships its types wrapped in an AMBIENT MODULE DECLARATION, and esm.sh
// rewrites the module name to the URL of the declaration file itself:
//
//     declare module 'https://esm.sh/stripe@18.5.0/types/index.d.ts' { ... }
//
// The specifier every edge function actually imports is
// `https://esm.sh/stripe@18.5.0` — no `/types/index.d.ts`. The strings do not
// match, no ambient declaration applies, and the module resolves to `any`.
// Silently: no error, no warning, 450 files downloaded and discarded.
//
// That is why `subscription.current_period_end` — a property Stripe removed
// from the Subscription object in API version 2025-03-31.basil, read by three
// call sites against a client pinned to 2025-08-27.basil — could not have been
// caught even by an editor with the file open. It is also why simply pointing
// `deno check` at these files was not enough: it reported 120 errors while
// every single Stripe call in the codebase was still untyped.
//
// `npm:stripe@18.5.0` is the same package at the same version, resolved
// through Deno's npm support, which handles the `export =` + namespace-merge
// correctly. Re-exporting the default binding from here carries BOTH meanings
// of the name across the map: the `Stripe` class (`new Stripe(key, ...)`) and
// the `Stripe` namespace (`Stripe.Event`, `Stripe.Subscription`, ...).
//
// Keep the version in the filename, the specifier below, and the `imports` key
// in scripts/edge-typecheck.deno.json in lockstep with the URL the functions
// import. If they ever drift, the map stops matching and Stripe silently
// reverts to `any` — so scripts/typecheck-edge.mjs asserts the mapping is live
// before it trusts a green result.
export { default } from "npm:stripe@18.5.0";
