/**
 * Q652 (owner, 2026-10-07): the landing page's first paint, rendered to HTML at
 * build time so `/` paints its hero before any JavaScript runs.
 *
 * Built by scripts/prerender-landing.mjs (vite SSR build of this entry) and
 * injected into dist/landing.html. It renders the REAL Index page components
 * (PublicLayout + HeroSection + HowItWorksSection) as a signed-out visitor sees
 * them, so the static paint and the React paint are the same markup by
 * construction; the hero is LOCKED and nothing here restyles it.
 */
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import Index from "@/pages/info/Index";

export function renderLanding(): string {
  return renderToString(
    <StaticRouter location="/">
      <Index />
    </StaticRouter>,
  );
}
