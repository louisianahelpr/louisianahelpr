import { useEffect } from "react";

/**
 * Keeps the screen on while `active` (Screen Wake Lock), for a long run the seller is told to wait for. A browser
 * without it, or one that refuses, simply sleeps as before: the run's own failures are named and kept. The browser
 * drops the lock whenever the page is hidden, so it is taken again on the way back.
 */
export function useScreenAwake(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let done = false;

    const take = async () => {
      try {
        const next = await navigator.wakeLock.request("screen");
        if (done) await next.release();
        else lock = next;
      } catch (err) {
        // Low battery, a hidden page or a refused permission: extra help lost, never a failure of the run.
        console.warn("[wakeLock] could not keep the screen on", err);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void take();
    };

    void take();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      done = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch((err: unknown) => console.warn("[wakeLock] could not let the screen sleep", err));
    };
  }, [active]);
}
