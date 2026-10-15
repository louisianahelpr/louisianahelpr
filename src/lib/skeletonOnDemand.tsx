/**
 * Per-route Suspense fallbacks (moved out of App.tsx unchanged, 2026-10-15,
 * to keep App.tsx inside its size ratchet), in the shape each route's own loading branch
 * uses — see the block comment in DashboardRouteSkeleton for why three
 * different-shaped frames in a row read as three loading screens.
 *
 * Q178: lazy, each behind the plain page ground. Imported statically they put
 * every route's skeleton (and DashboardTitleBar -> NotificationPanel ->
 * popover -> Radix, ~45 KB gzip) on EVERY cold load, the landing's included,
 * competing for the same bandwidth as the page actually being opened. Since the
 * entry now starts the page chunk in the first round, a skeleton chunk lands
 * in the same round as the page it stands in for.
 */
import { lazy, Suspense, type ComponentType } from "react";

export const skeletonOnDemand = <P extends object>(load: () => Promise<{ default: ComponentType<P> }>) => {
  // Typed back to the plain component: LazyExoticComponent widens props to
  // PropsWithRef<P>, which a generic P cannot be proven to satisfy.
  const Lazy = lazy(load) as unknown as ComponentType<P>;
  const Skeleton = (props: P) => (
    <Suspense fallback={<div className="min-h-screen bg-premium-page" aria-busy="true" />}>
      <Lazy {...props} />
    </Suspense>
  );
  return Skeleton;
};
