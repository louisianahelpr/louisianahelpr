import { useCallback, useEffect, useState } from "react";
import { isNativePlatform } from "@/lib/nativeInit";
import {
  GATE_OFF,
  normalizeMinBuild,
  parseBuildNumber,
  readMinSupportedBuild,
} from "@/lib/minSupportedBuild";
import { CLIENT_COMPAT_EPOCH, FLOOR_UNKNOWN, isBelowFloor, normalizeFloor, readClientCompatFloor } from "@/lib/clientCompat";
import { PERMISSION_DENIED_EVENT } from "@/lib/permissionDenied";

/**
 * useVersionCheck — is this binary still allowed to run?
 *
 * Compares the RUNNING native build number against
 * `platform_settings.min_supported_build` and reports whether the install is
 * too old to continue. `ForceUpdateGate` renders the answer; the decision and
 * every one of its escape hatches live here.
 *
 * ── WHERE THE BUILD NUMBER COMES FROM ────────────────────────────────────
 * `@capacitor/app`'s `App.getInfo()`, which returns
 * `{ name, id, build, version }`. `build` is `CFBundleVersion` on iOS and
 * `versionCode` on Android — the same integer App Store Connect increments,
 * and the same one an operator types into Admin → Settings. Today's binary is
 * CFBundleVersion 5906 / MARKETING_VERSION 1.0.4
 * (ios/App/App/Info.plist:24, ios/App/App.xcodeproj/project.pbxproj).
 *
 * It is read from the plugin rather than from a build-time constant on
 * purpose. A constant baked into the JS bundle describes the bundle, and the
 * whole premise of this gate is a JS bundle riding inside a NATIVE binary that
 * cannot be replaced remotely. The number that matters is the one Apple has,
 * and `getInfo()` is the only thing that knows it.
 *
 * ── WHAT HAPPENS ON THE WEB ──────────────────────────────────────────────
 * Nothing. The web app is never blocked, and does not even make the request.
 *
 * `min_supported_build` is a statement about native binaries. The web app has
 * no build number at all — `App.getInfo()` is `unimplemented` on web and
 * throws (node_modules/@capacitor/app/dist/esm/web.js) — and it does not need
 * one, because a browser picks up a fix on the next reload. There is no
 * "stuck on an old build" state to rescue it from.
 *
 * Blocking web on a native threshold would therefore be wrong twice over: it
 * would turn away users who are already running the newest code, and it would
 * do so at the exact moment an operator raises the number during a native
 * incident — taking out the one surface that was still working, plus /admin
 * itself, which is where the number gets lowered again. So the platform check
 * is the first thing this hook does and it short-circuits everything else.
 *
 * ── FAIL OPEN ────────────────────────────────────────────────────────────
 * See lib/minSupportedBuild.ts for the full argument. Summary: a blocked app
 * cannot be un-blocked without App Review, so every uncertainty resolves to
 * "let them in". Not native, `getInfo()` throws, build unparseable, threshold
 * 0 / missing / unreadable, settings read failed — all `status: "ok"`.
 *
 * The check also does NOT hold up first paint. It resolves asynchronously and
 * children render while it is in flight, so a healthy launch pays nothing for
 * the gate. The cost is that a genuinely too-old build shows the app for one
 * round trip before the block lands; that is a far better trade than adding an
 * RTT to every launch for every user on every platform.
 */

/**
 * DEV-ONLY harness. `import.meta.env.DEV` is a compile-time `false` in every
 * production build, so Rollup drops this whole branch and the query params do
 * nothing in the shipped app — the same guard `APP_LOCK_DEMO` uses in
 * lib/appLock.ts, and for the same reason: this gate is native-only by design,
 * so without a harness there is no way to see the blocked state in a browser
 * at all, which is how it would ship unlooked-at.
 *
 *   ?force_update_demo=1                  → simulate native, read the real threshold
 *   ?force_update_demo=1&build=5906       → pretend the installed build is 5906
 *   ?force_update_demo=1&min=6000         → pretend the stored threshold is 6000
 *   ?force_update_demo=1&min=fail         → pretend the settings read failed
 *   ?force_update_demo=1&compat_floor=2   → pretend client_compat_floor() is 2
 */
function demoParams(): URLSearchParams | null {
  if (!import.meta.env.DEV) return null;
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.has("force_update_demo") ? params : null;
}

export type VersionCheck =
  /** Still deciding. Treated as OK everywhere — the app renders. */
  | { status: "checking" }
  /** Allowed to run: up to date, gate off, or something was unknowable. */
  | { status: "ok" }
  /** Too old. The only state that blocks. */
  | {
      status: "blocked";
      /**
       * "build": the binary is below min_supported_build (operator lever).
       * "compat": the bundle inside it is below client_compat_floor(), i.e. a
       * migration has since narrowed what it reads (src/lib/clientCompat.ts).
       */
      reason: "build" | "compat";
      installedBuild: number | null;
      requiredBuild: number;
      /** Present for "compat": this bundle's epoch and the server's floor. */
      compat?: { epoch: number; floor: number };
    };

/**
 * The ONE place `@capacitor/app` is imported.
 *
 * Both consumers below route through this instead of each writing their own
 * `await import(...)`: the plugin is named once, the lazy chunk is requested
 * from one site, and a stand-in supplied under test covers both paths rather
 * than one of them.
 *
 * ── IT RETURNS A WRAPPER, AND MUST ───────────────────────────────────────
 * `return App` here instead of `return { App }` and every call fails with
 *   Error: "App.then()" is not implemented on web   { code: 'UNIMPLEMENTED' }
 * — found while writing this file's tests, and worth spelling out because the
 * broken version reads perfectly.
 *
 * `registerPlugin()` hands back a Proxy whose `get` trap manufactures a method
 * for ANY property name (that is how it forwards calls it has never heard of
 * to the native layer). Resolving a promise with it therefore triggers
 * JavaScript's thenable assimilation: the runtime probes `.then`, the Proxy
 * cheerfully invents one, the runtime CALLS it, and the bridge rejects with
 * UNIMPLEMENTED. The plugin is fine; awaiting it is what breaks.
 *
 * Because both call sites sit behind a `catch` that fails open, the failure
 * would have been perfectly silent in production — the gate would simply never
 * fire and never say why. Rule: destructure a Capacitor plugin out of its
 * module (or out of a wrapper) and never let it BE a promise's resolved value.
 */
let appPluginPromise: Promise<{ App: typeof import("@capacitor/app").App }> | null = null;
function capacitorApp(): Promise<{ App: typeof import("@capacitor/app").App }> {
  // Memoised, so the chunk is fetched once no matter how many foregrounds the
  // app sees, and so both callers below are guaranteed to be holding the same
  // object rather than racing two resolutions of the same specifier.
  appPluginPromise ??= import("@capacitor/app").then((m) => ({ App: m.App }));
  return appPluginPromise;
}

/**
 * Read the running binary's build number, or null if there isn't one we can
 * compare. Null is a fail-open answer, never a blocking one.
 */
async function readInstalledBuild(): Promise<number | null> {
  const demo = demoParams();
  if (demo) {
    const forced = demo.get("build");
    // No explicit build in the harness → stand in the real shipping value so
    // the numbers on screen are the ones an operator would actually see.
    return parseBuildNumber(forced ?? "5906");
  }
  if (!isNativePlatform) return null;
  try {
    const { App } = await capacitorApp();
    const info = await App.getInfo();
    return parseBuildNumber(info?.build);
  } catch (err) {
    // Plugin missing, or `getInfo()` unimplemented (this is what web does).
    // Not dropped — logged — but it can only ever mean "do not block".
    console.warn("[useVersionCheck] could not read the app build number:", err);
    return null;
  }
}

/** The threshold, honouring the dev harness's overrides. */
async function readThreshold(): Promise<number> {
  const demo = demoParams();
  const forced = demo?.get("min");
  if (forced != null) {
    // `min=fail` models the settings read failing, which must land on the
    // same answer as a real failure: the gate off.
    if (forced === "fail") return GATE_OFF;
    return normalizeMinBuild(forced);
  }
  return readMinSupportedBuild();
}

/** The compat floor, honouring the dev harness's override. */
async function readCompatFloor(force: boolean): Promise<number> {
  const forced = demoParams()?.get("compat_floor");
  if (forced != null) return normalizeFloor(forced);
  return readClientCompatFloor({ force });
}

/**
 * Set once this process has seen a grant refusal (permission-denied event).
 *
 * The compat block waits for it: below the floor alone does not block.
 * Reason (lh-authz-rls review 2026-10-05): the floor rises the moment its
 * migration deploys, but a native binary carrying the new epoch needs a
 * TestFlight/App Store build first. Blocking on the number alone would lock
 * every native user out of the WHOLE app until that build exists, including
 * people who never open the screens the migration broke. With evidence, only a
 * user whose read was actually refused gets "Update Helpr" instead of "We
 * couldn't load this"; everyone else keeps working. (The operator lever,
 * min_supported_build, still blocks on the number alone.)
 */
let deniedSeen = false;
export function __resetDeniedSeenForTests() {
  deniedSeen = false;
}

export function useVersionCheck(): VersionCheck {
  const [state, setState] = useState<VersionCheck>({ status: "checking" });

  const check = useCallback(async (force = false): Promise<VersionCheck> => {
    // The web short-circuit, first and cheapest. No plugin import, no RPC.
    // (Web has its own path for both levers: src/lib/staleClient.ts reloads.)
    if (!isNativePlatform && !demoParams()) return { status: "ok" };

    const [installed, required, floor] = await Promise.all([
      readInstalledBuild(),
      readThreshold(),
      readCompatFloor(force),
    ]);

    // The operator's build lever first: its numbers are the ones support asks for.
    // Gate off (0 is the documented off value), or nothing to compare: not blocked.
    if (required > GATE_OFF && installed !== null && installed < required) {
      return { status: "blocked", reason: "build", installedBuild: installed, requiredBuild: required };
    }
    // The schema lever: this bundle reads columns the server no longer grants.
    // Fails open like the build lever: FLOOR_UNKNOWN never blocks.
    // The dev harness's compat_floor stands in for the evidence too, so the
    // blocked screen can be looked at in a browser.
    const evidence = deniedSeen || demoParams()?.has("compat_floor") === true;
    if (evidence && floor > FLOOR_UNKNOWN && isBelowFloor(floor, CLIENT_COMPAT_EPOCH)) {
      return {
        status: "blocked",
        reason: "compat",
        installedBuild: installed,
        requiredBuild: required,
        compat: { epoch: CLIENT_COMPAT_EPOCH, floor },
      };
    }
    return { status: "ok" };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = (force = false) => {
      void check(force).then((next) => {
        if (!cancelled) setState(next);
      });
    };

    run();

    // Re-check on foreground.
    //
    // Without this the gate only ever fires on a cold start, and phones are
    // rarely cold-started — an operator raising the threshold mid-incident
    // would reach a backgrounded install whenever its owner next killed the
    // app, which may be never. `resume` is willEnterForeground on iOS; the
    // read behind it is cached for 60s, so a user flicking between apps does
    // not generate a request per switch. (`appStateChange` would have been
    // wrong here for the reason lib/appLock.ts documents at length: it also
    // fires for the notification shade and Control Centre.)
    //
    // Deliberately one-directional in effect: a re-check can start blocking,
    // and can also stop blocking if the operator lowers the number back — the
    // state is recomputed from scratch each time rather than latched, so a
    // threshold set in error is undone by fixing it, not by an app update.
    if (!isNativePlatform) return () => { cancelled = true; };

    // A 42501 is what an out-of-date bundle gets for a withheld column: ask
    // again at once (skipping the 60 s cache) instead of leaving the user on
    // "We couldn't load this" until the next resume.
    const onDenied = () => {
      deniedSeen = true;
      run(true);
    };
    window.addEventListener(PERMISSION_DENIED_EVENT, onDenied);

    let remove: (() => void) | null = null;
    void (async () => {
      try {
        const { App } = await capacitorApp();
        const handle = await App.addListener("resume", () => run());
        if (cancelled) {
          void handle.remove();
          return;
        }
        remove = () => void handle.remove();
      } catch {
        /* plugin unavailable — the cold-start check above still ran */
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener(PERMISSION_DENIED_EVENT, onDenied);
      remove?.();
    };
  }, [check]);

  return state;
}
