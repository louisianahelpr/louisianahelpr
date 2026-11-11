import { useRef, useState, type ComponentType, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { keepsPageState } from "@/lib/keepPage";

// PageTransition (the iPhone edge swipe-back) and ScrollToTop no longer use
// framer-motion (Q1356; check-deferred-vendors.mjs holds them to it). Q178: a
// lazy wrapper suspends its CHILDREN until its chunk lands, so no route could
// REQUEST its page chunk before PageTransition arrived (Index at 3.9 s on a slow
// phone). So the wrapper never suspends: until the gesture component has
// loaded it renders a plain keyed <div> (a cold first page has no history to
// swipe back to). It loads once the page has settled (App.tsx calls
// loadAnimatedPageTransition). The pick is made once per page key (below), so a
// page never swaps wrappers (which would remount it) mid-life.
let AnimatedPageTransition: ComponentType<{ children: ReactNode }> | null = null;
export const loadAnimatedPageTransition = () =>
  import("@/components/PageTransition").then((m) => {
    AnimatedPageTransition = m.default;
  });

const PageTransitionPick = ({ pageKey, children }: { pageKey: string; children: ReactNode }) => {
  const [Animated] = useState(() => AnimatedPageTransition);
  if (!Animated) return <div key={pageKey}>{children}</div>;
  return <Animated>{children}</Animated>;
};
// Keyed so each navigation re-picks: React reuses this across same-shaped
// routes, and a once-per-mount pick kept a cold start's plain div, without the
// swipe-back, for the whole session (/login -> /signup, 2026-10-12). A KEEP_PAGE
// step on the same pathname keeps the key it had (src/lib/keepPage.ts).
export const RoutePageTransition = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const kept = useRef<{ key: string; pathname: string } | null>(null);
  const prev = kept.current;
  const keepsPage = prev !== null && prev.pathname === location.pathname && keepsPageState(location.state);
  const pageKey = keepsPage ? prev.key : location.key;
  kept.current = { key: pageKey, pathname: location.pathname };
  return <PageTransitionPick key={pageKey} pageKey={pageKey}>{children}</PageTransitionPick>;
};
