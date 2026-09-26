/**
 * The ONE place an inbound native URL becomes a navigation (NB-017).
 *
 * A URL reaches the app two ways, and both go through `routeIncomingUrl`:
 *
 *   1. `App.addListener("appUrlOpen")` — a Universal Link or a `helpr://`
 *      Stripe return while the process is alive. On iOS the plugin notifies
 *      with `retainUntilConsumed: true`, so a URL that arrived before this
 *      listener existed (a COLD START from the link) is replayed to it the
 *      moment it attaches.
 *   2. `App.getLaunchUrl()` — read once at boot. On iOS it returns
 *      `ApplicationDelegateProxy.shared.lastURL`: the last URL opened, which on
 *      a cold start is the same URL the retained `appUrlOpen` replays. On
 *      Android it is the launch intent's data, which `appUrlOpen` does not
 *      replay.
 *
 * So on an iOS cold start the SAME URL arrives twice, in either order. Before
 * this module both copies ran the whole handler: two `Browser.close()` calls
 * and two `navigate()`s (a duplicate history entry — Back went nowhere). The
 * pair is collapsed here: a launch read and an `appUrlOpen` for the same URL
 * within LAUNCH_TWIN_WINDOW_MS are one delivery. Two taps of the same link
 * (both `appUrlOpen`) are two deliveries and both route.
 *
 * WHY THIS IS NOT INSIDE THE PUSH SETUP ANY MORE. The listener used to be
 * attached at the END of `useNativePushSetup`'s single try block, behind six
 * awaited push-plugin calls. Any throw above it (plugin import, an
 * addListener, checkPermissions) skipped deep-link registration for the life
 * of the process — no Universal Links, no Stripe hand-back — with one
 * `useNativePushSetup` error_logs row as the only trace. `startDeepLinkRouting`
 * owns its own chain and its own try, and is started before push setup.
 *
 * Never `await` a Capacitor plugin object (CLAUDE.md, thenable assimilation):
 * the plugin is always destructured from the dynamic import.
 */
import { Browser } from "@capacitor/browser";
import { track, AhaEvent } from "@/lib/analytics";
import { report } from "@/lib/errorLogger";
import { normalizeDeepLinkUrl, NATIVE_RETURN_SCHEME } from "@/lib/deepLinkRoute";
import { claimDeepLinkLaunch } from "@/lib/nativeLaunchMutex";

type DeepLinkSource = "launch" | "appUrlOpen";

/**
 * How long after one delivery its twin from the OTHER source is still "the
 * same delivery". Both arrive during boot, within one bridge round trip of
 * each other; the window only has to outlast that, and must stay short so a
 * deliberate re-tap of the same link later is never swallowed.
 */
export const LAUNCH_TWIN_WINDOW_MS = 10_000;

let lastRouted: { url: string; source: DeepLinkSource; at: number } | null = null;
let routingStarted = false;

/** Test seam: forget the de-duplication state and the started flag. */
export function resetDeepLinkRouterForTests(): void {
  lastRouted = null;
  routingStarted = false;
}

/**
 * True when this delivery is the other half of one already routed: the same
 * URL, from the other source, inside the window. Consumes the pairing so a
 * third copy is treated as a fresh delivery.
 */
function isLaunchTwin(url: string, source: DeepLinkSource, now: number): boolean {
  if (!lastRouted) return false;
  const twin =
    lastRouted.url === url &&
    lastRouted.source !== source &&
    now - lastRouted.at < LAUNCH_TWIN_WINDOW_MS;
  if (twin) lastRouted = null;
  return twin;
}

/**
 * Route one inbound URL. Every native URL, from either source, comes through
 * here — src/test/deepLinkOneRouter.test.ts fails if a second path appears.
 */
async function routeIncomingUrl(
  rawUrl: string,
  source: DeepLinkSource,
  navigate: (to: string) => void,
): Promise<void> {
  try {
    if (!rawUrl) return;
    if (isLaunchTwin(rawUrl, source, Date.now())) return;
    lastRouted = { url: rawUrl, source, at: Date.now() };

    // Parse for analytics (host + raw path) even if we end up ignoring the
    // URL — we still want to know how often foreign-host links reach the
    // bridge.
    let host = "";
    let rawPath = "";
    try {
      const parsed = new URL(rawUrl);
      host = parsed.host;
      rawPath = parsed.pathname;
    } catch {
      // Unparseable: still tracked (with empty host/path) so a malformed link
      // is counted; normalizeDeepLinkUrl below returns null for it.
    }
    track(AhaEvent.AppOpenedFromDeepLink, { host, path: rawPath, source });

    // A `helpr://` URL means Stripe just handed us back from the in-app
    // browser sheet. Close it first — otherwise we route underneath a sheet
    // that is still covering the screen and the user sees nothing change.
    if (rawUrl.startsWith(`${NATIVE_RETURN_SCHEME}:`)) {
      try {
        await Browser.close();
      } catch (err) {
        // Already dismissed, or no sheet open. Routing is what matters; never
        // let this stop the hand-back.
        report(err, { tags: { source: "nativeReturn.browserClose" } });
      }
    }

    const internal = normalizeDeepLinkUrl(rawUrl);
    if (internal) {
      // Mark first so NativeLaunchRouter (which may resolve a moment later in
      // a parallel useEffect) doesn't override the deep link with the default
      // post-auth route.
      claimDeepLinkLaunch();
      navigate(internal);
    }
  } catch (err) {
    report(err, { tags: { source: "appUrlOpen" }, context: { url: rawUrl, via: source } });
  }
}

/**
 * Attach the `appUrlOpen` listener, then read the launch URL — once per
 * process. The listener goes first so the retained cold-start event and the
 * launch read race only each other, which `routeIncomingUrl` collapses.
 *
 * STRICT host check lives in `normalizeDeepLinkUrl`: on TestFlight
 * cold-install Capacitor sometimes fires appUrlOpen with the install-source
 * URL; the allowlist keeps it from yanking a fresh user off the guest feed.
 */
export async function startDeepLinkRouting(navigate: (to: string) => void): Promise<void> {
  if (routingStarted) return;
  routingStarted = true;
  try {
    const { App } = await import("@capacitor/app");

    await App.addListener("appUrlOpen", (event) => {
      // Listener signature is sync; surface any rejection rather than letting
      // it become an unhandled one.
      void routeIncomingUrl(event.url, "appUrlOpen", navigate).catch((err) =>
        report(err, { tags: { source: "appUrlOpen" } }),
      );
    });

    try {
      const launch = await App.getLaunchUrl();
      if (launch?.url) await routeIncomingUrl(launch.url, "launch", navigate);
    } catch (err) {
      report(err, { tags: { source: "getLaunchUrl" } });
    }
  } catch (err) {
    report(err, { tags: { source: "startDeepLinkRouting" } });
  }
}
