import type { Locator } from "@playwright/test";
import { test } from "./fixtures";

/**
 * Click `target`. When the click times out, record what the page did frame by
 * frame before rethrowing, so the failure says WHY the element never became
 * "visible, enabled and stable" instead of only that it did not.
 *
 * Why (nightly-red #2436): in Playwright's Linux WebKit the Filters sheet's
 * chips ("Highest pay" in 01-browse, "Cleaning" in 03-account) waited 20s for
 * "stable" and timed out on every journeys-webkit run read (e2e-journeys
 * 38527058685, 38749234414, 38882683467, 39004547274), on phone-375,
 * iphone-webkit and largest-text, on fast, slow and drops networks. The trace's
 * DOM snapshots show a static panel (popper wrapper translate(0px, 70px) at
 * the start and the end of the wait). The same click passes in the chromium
 * project, and in macOS WebKit locally the chip settles 8 frames after the
 * panel opens (sec-c probe, 2026-10-17). So the moving part (or a stalled
 * requestAnimationFrame) is only visible in that engine on CI: this records it.
 *
 * Per frame, for 40 frames: ms since the first frame, the target's rect, the
 * nearest scroller's scrollTop, the dialog's rect, the visual viewport, and
 * the running animations. Rethrows the click's own error unchanged.
 */
export async function clickOrSayWhatMoves(target: Locator, timeout = 20_000): Promise<void> {
  try {
    await target.click({ timeout });
  } catch (err) {
    const frames = await target
      .evaluate(
        (el) =>
          new Promise<unknown[]>((resolve) => {
            const out: unknown[] = [];
            const t0 = performance.now();
            let scroller: Element | null = el.parentElement;
            while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) {
              scroller = scroller.parentElement;
            }
            const r = (x: Element | null | undefined) => {
              if (!x) return null;
              const b = x.getBoundingClientRect();
              return [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 1000) / 1000);
            };
            const tick = () => {
              const vv = window.visualViewport;
              out.push({
                ms: Math.round(performance.now() - t0),
                el: r(el),
                scrollTop: scroller ? scroller.scrollTop : null,
                dialog: r(el.closest('[role="dialog"]')),
                vv: vv ? [vv.offsetTop, vv.pageTop, vv.height, vv.scale] : null,
                anims: document
                  .getAnimations()
                  .filter((a) => a.playState === "running")
                  .map((a) => {
                    const tgt = (a.effect as KeyframeEffect | null)?.target as Element | null;
                    const name = (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "";
                    return `${name}@${tgt?.tagName ?? "?"}.${String(tgt?.className ?? "").slice(0, 40)}`;
                  })
                  .slice(0, 8),
              });
              if (out.length < 40) requestAnimationFrame(tick);
              else resolve(out);
            };
            requestAnimationFrame(tick);
            // A page whose requestAnimationFrame never fires is itself the answer.
            setTimeout(() => resolve(out.length ? out : ["requestAnimationFrame did not fire in 5s"]), 5_000);
          }),
        undefined,
        { timeout: 10_000 },
      )
      .catch((e: unknown) => [`could not sample: ${String(e).slice(0, 200)}`]);
    const description = JSON.stringify(frames);
    test.info().annotations.push({ type: "not-stable", description: description.slice(0, 6_000) });
    console.log(`clickOrSayWhatMoves: ${String(target)} never clicked; frames: ${description.slice(0, 6_000)}`);
    throw err;
  }
}
