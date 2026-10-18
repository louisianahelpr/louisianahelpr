import { useLocation, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { prefetchRoute } from "@/lib/routePrefetch";
import { useAgeGate } from "@/hooks/useAgeGate";

const VIEWS = [
  { path: "/home", label: "Browse" },
  { path: "/posts", label: "My posts" },
  { path: "/jobs", label: "My jobs" },
] as const;

/* FITS AT EVERY WIDTH (design slice 2, measured at 320). The three views and
   the '+ Post' pill need ~333px at the roomy padding, so below 400px the views
   tighten to px-2 (one line down to ~360px), and below that the row WRAPS:
   the views keep the first line and '+ Post' drops to a second, right
   aligned. Nothing scrolls out of sight (it used to show "M" of "My jobs" at
   320). The skeleton uses the same three constants, so nothing moves (Q169). */
const BAR_ROW = "flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5";
const VIEWS_ROW = "flex min-w-0 flex-auto items-center gap-1 overflow-x-auto";
const VIEW_PAD = "px-3 max-[399px]:px-2";

/**
 * JOBS & POSTS' section strip (owner, 2026-10-18, G2: a Browse | Mine switch in
 * every section; NO '+' in the bottom bar, a labeled '+ Post' pill in the
 * section header instead). The three pages that used to be three bottom-bar
 * tabs (Home feed, My posts, My jobs) are one section now, switched here.
 *
 * Links, not a tablist: each view is its own route (aria-current marks where
 * you are). Every control is at least 44px tall.
 */
export function JobsPostsBar() {
  const location = useLocation();
  const navigate = useNavigate();
  // Q1586(c): a saved birthday under 18 greys Post out; a tap says why.
  const { gate, gatedProps } = useAgeGate();
  return (
    <div className={BAR_ROW} data-testid="jobs-posts-bar">
      <nav aria-label="Jobs & Posts" className={VIEWS_ROW}>
        {VIEWS.map((v) => {
          const on = location.pathname === v.path;
          return (
            <button
              key={v.path}
              type="button"
              aria-current={on ? "page" : undefined}
              onClick={() => (on ? undefined : navigate(v.path))}
              onMouseEnter={() => prefetchRoute(v.path)}
              className={`min-h-11 shrink-0 rounded-full ${VIEW_PAD} text-ds-14 whitespace-nowrap ctl-tint`}
              style={{
                fontWeight: on ? 700 : 500,
                color: on ? "hsl(var(--brand-ink))" : "hsl(var(--ink-deep))",
                background: on ? "hsl(var(--brand) / 0.10)" : "transparent",
              }}
            >
              {v.label}
            </button>
          );
        })}
      </nav>
      <button
        type="button"
        onClick={gate("post", () => navigate("/post-job"))}
        {...gatedProps("post")}
        onMouseEnter={() => prefetchRoute("/post-job")}
        className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3.5 text-ds-14 font-semibold whitespace-nowrap transition-transform active:scale-[0.97]"
        style={{ backgroundColor: "hsl(var(--brand))", color: "hsl(var(--brand-foreground))" }}
      >
        <Plus className="h-4 w-4" strokeWidth={2.75} aria-hidden />
        Post
      </button>
    </div>
  );
}

/**
 * The strip's loading copy for the route skeletons (Dashboard, My posts, My
 * jobs): the same row, the same 44px pills, the same words, so nothing moves
 * when the page lands (Q169). Hook-free and inert (aria-hidden, no buttons):
 * a skeleton can render before the router or the age gate is ready.
 */
export function JobsPostsBarSkeleton({ current }: { current: (typeof VIEWS)[number]["path"] }) {
  return (
    <div className={BAR_ROW} data-testid="jobs-posts-bar-skeleton" aria-hidden>
      <div className={VIEWS_ROW}>
        {VIEWS.map((v) => {
          const on = v.path === current;
          return (
            <span
              key={v.path}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-full ${VIEW_PAD} text-ds-14 whitespace-nowrap`}
              style={{
                fontWeight: on ? 700 : 500,
                color: on ? "hsl(var(--brand-ink))" : "hsl(var(--ink-deep))",
                background: on ? "hsl(var(--brand) / 0.10)" : "transparent",
              }}
            >
              {v.label}
            </span>
          );
        })}
      </div>
      <span
        className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3.5 text-ds-14 font-semibold whitespace-nowrap"
        style={{ backgroundColor: "hsl(var(--brand))", color: "hsl(var(--brand-foreground))" }}
      >
        <Plus className="h-4 w-4" strokeWidth={2.75} aria-hidden />
        Post
      </span>
    </div>
  );
}
