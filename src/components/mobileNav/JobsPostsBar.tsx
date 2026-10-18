import { useLocation, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { prefetchRoute } from "@/lib/routePrefetch";
import { useAgeGate } from "@/hooks/useAgeGate";

const VIEWS = [
  { path: "/home", label: "Browse" },
  { path: "/posts", label: "My posts" },
  { path: "/jobs", label: "My jobs" },
] as const;

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
    <div className="flex items-center gap-2" data-testid="jobs-posts-bar">
      <nav aria-label="Jobs & Posts" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {VIEWS.map((v) => {
          const on = location.pathname === v.path;
          return (
            <button
              key={v.path}
              type="button"
              aria-current={on ? "page" : undefined}
              onClick={() => (on ? undefined : navigate(v.path))}
              onMouseEnter={() => prefetchRoute(v.path)}
              className="min-h-11 shrink-0 rounded-full px-3 text-ds-14 whitespace-nowrap ctl-tint"
              style={{
                fontWeight: on ? 700 : 500,
                color: on ? "hsl(var(--brand))" : "hsl(var(--ink-deep))",
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

export default JobsPostsBar;
