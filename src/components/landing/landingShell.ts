/**
 * The guest landing's HTML-drawn first screen (B100, Q2705/Q2708; lead 11-04, hero LOCKED).
 *
 * index.html carries #lh-landing-shell: the landing's top bar and hero, rendered from the app's own PublicLayout +
 * HeroSection (src/test/landingShellMatchesHero.test.tsx holds the block byte-equal to that render and rewrites it
 * with LH_WRITE_LANDING_SHELL=1). An inline script in index.html shows it only on "/" for a visitor with no stored
 * session outside the native app, and removes it after 10 s whatever happens. It is fixed over the page, so the
 * visitor sees the hero at first paint instead of after the whole app.
 *
 * HeroSection calls removeLandingShellOncePainted() when it mounts: two animation frames later React's own hero (the
 * same markup, same place) has been painted underneath, so taking the overlay away changes no pixel and is not a
 * layout shift (a fixed overlay leaving moves nothing).
 */
const LANDING_SHELL_ID = "lh-landing-shell";

export function removeLandingShellOncePainted(doc: Document = document): void {
  const el = doc.getElementById(LANDING_SHELL_ID);
  if (!el) return;
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 16);
  raf(() => raf(() => el.remove()));
}
