import { useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { GroupSection, GroupRow } from "@/components/sections/StatusBoxes";
import { CustomizeSheet } from "@/components/sections/CustomizeSheet";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useSectionTabs, sayComingSoon } from "@/components/mobileNav/useSectionTabs";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatJobDate } from "@/lib/dateUtils";
import { useHomeSummary, type ComingUpItem } from "./homeDashboard/useHomeSummary";
import { useOnTabReselect } from "@/components/mobileNav/tabReselect";
import { feedLinkTarget } from "./homeDashboard/feedLinkForward";

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** "Baton Rouge · Sun, Oct 25 · 9:00 AM" — location, then date, then time (owner, 2026-10-19). */
export function jobMetaLine(job: ComingUpItem["job"]) {
  const time = job.start_time ? new Date(`1970-01-01T${job.start_time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
  return [job.location?.split(",")[0], job.date_needed ? formatJobDate(job.date_needed) : null, time].filter(Boolean).join(" · ");
}

/**
 * HOME (owner final decisions, 2026-10-19; 2026-10-20 the three stat boxes became
 * the NEXT UP card, HELPR-DESIGN-SPEC §4). Greeting (Bodoni, a moment); Next up
 * (the most urgent to-do from every section and both sides, with its action);
 * the full To do list, COLLAPSED until Next up's "See all" is tapped, the one
 * control that opens it (owner, 2026-10-19: "only show To do expanded when
 * it's clicked"). Never remembered: Home arrives collapsed on
 * load, on coming back from a section, and on a re-tap of the Home tab. The
 * member's sections as 2x2 boxes; Coming up. No "+" and no category pills.
 */
export default function HomeDashboard() {
  const { search, hash } = useLocation();
  const forward = feedLinkTarget(search, hash);
  // A link that opens something IN the job feed goes to the feed (Jobs > Browse).
  if (forward) return <Navigate replace to={forward} />;
  return <HomeDashboardScreen />;
}

function HomeDashboardScreen() {
  const navigate = useNavigate();
  const { user, profile } = useCurrentUser();
  const summary = useHomeSummary(user);
  const { visible } = useSectionPrefs();
  const live = useSectionTabs();
  // Plain state, never stored: a remount (load, coming back) starts collapsed.
  const [todoOpen, setTodoOpen] = useState(false);
  const toggleTodo = () => setTodoOpen((o) => !o);
  useOnTabReselect("/home", () => setTodoOpen(false));
  // Profile's "Your sections" row opens Home with ?customize=1.
  const [params, setParams] = useSearchParams();
  const [customize, setCustomizeState] = useState(params.get("customize") === "1");
  const setCustomize = (open: boolean) => {
    setCustomizeState(open);
    if (!open && params.has("customize")) setParams((p) => { const n = new URLSearchParams(p); n.delete("customize"); return n; }, { replace: true });
  };
  const first = profile?.full_name?.split(" ")[0];
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const todoCount = summary.todos.length;

  // Next up is a carousel over the to-dos (mock-up 7: "Next up · 1 of 5"); it opens on the most urgent.
  const [shown, setShown] = useState(0);
  const at = Math.min(shown, Math.max(0, todoCount - 1));
  const next = summary.todos[at];
  const rest = Math.max(0, todoCount - 1);

  return (
    <SectionScreen>
      <div data-testid="home-dashboard" className="flex flex-col gap-section">
        <div>
          <h1 className="font-moment text-page-title text-foreground">{first ? `${greeting()}, ${first}` : greeting()}</h1>
          <p className="text-ds-14 text-muted-foreground mt-0.5">{today}</p>
        </div>

        {/* NEXT UP (owner, 2026-10-20; HELPR-DESIGN-SPEC §4 Home): the single most urgent
            to-do from every section and both sides, with its one action. Replaces the three
            stat boxes. Nothing invented: no to-do, no task; the money line only when the
            to-do carries a real amount. "See all" is the ONE control for the full list. */}
        <section data-testid="next-up" aria-label="Next up" className="liquid-glass p-card flex flex-col gap-1.5">
          <h2 data-testid="next-up-label" className="text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {todoCount > 1 ? `Next up · ${at + 1} of ${todoCount}` : "Next up"}
          </h2>
          {next ? (
            <>
              <p data-testid="next-up-title" className="text-ds-18 font-bold leading-snug text-foreground [overflow-wrap:anywhere]">{next.title}</p>
              <p className="text-ds-14 text-muted-foreground">
                {next.money && <span className="font-bold" style={{ color: "hsl(var(--accent-ink))" }}>{next.money} order total</span>}
                {next.money && " · "}
                {next.meta}
              </p>
              {todoCount > 1 && (
                <div className="flex items-center -ml-2" role="group" aria-label="Your to-dos">
                  {summary.todos.slice(0, 8).map((t, i) => (
                    <button
                      key={t.id}
                      type="button"
                      data-next-up-dot={i}
                      aria-label={`To-do ${i + 1} of ${todoCount}`}
                      aria-current={i === at ? "true" : undefined}
                      onClick={() => setShown(i)}
                      className="h-11 w-6 flex items-center justify-center"
                    >
                      <span aria-hidden className={`h-1.5 rounded-full transition-all ${i === at ? "w-4 bg-primary" : "w-1.5 bg-border"}`} />
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between gap-3 mt-1">
                <button type="button" data-testid="next-up-action" onClick={() => navigate(next.to)} className="btn-grad-primary btn-press rounded-full min-h-11 px-5 text-ds-15 font-semibold">
                  {next.action}
                </button>
                {rest > 0 && (
                  <button
                    type="button"
                    data-testid="next-up-see-all"
                    aria-expanded={todoOpen}
                    aria-controls={todoOpen ? "home-todo-list" : undefined}
                    onClick={toggleTodo}
                    className="min-h-11 px-1 text-ds-14 font-bold text-primary"
                  >
                    {todoOpen ? "Hide" : `See all (${todoCount})`}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="font-moment text-ds-22 leading-tight text-foreground">You're all caught up</p>
              <p className="text-ds-14 text-muted-foreground">Orders to answer and jobs that need you show up here.</p>
            </>
          )}
        </section>

        {todoOpen && (
          <div data-testid="todo-list" id="home-todo-list">
            <GroupSection title="To do" count={todoCount}>
              {summary.todos.map((t, i, arr) => (
                <GroupRow key={t.id} title={t.title} meta={t.meta} onClick={() => navigate(t.to)} last={i === arr.length - 1} />
              ))}
            </GroupSection>
          </div>
        )}

        <section className="flex flex-col gap-2" aria-label="Your sections">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-ds-13 font-bold uppercase tracking-[0.06em] text-muted-foreground">Your sections</h2>
            <button type="button" data-testid="open-customize" onClick={() => setCustomize(true)} className="text-ds-13 font-semibold text-primary">
              Customize
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {visible.map((s) => {
              const on = s.feature === null || live.find((t) => t.path === s.path)?.on;
              const tile = summary.tiles[s.key];
              const Icon = s.icon;
              return (
                <button
                  key={s.key}
                  type="button"
                  data-section-tile={s.key}
                  aria-label={on ? s.label : `${s.label}, coming soon`}
                  aria-disabled={on ? undefined : true}
                  onClick={() => (on ? navigate(s.path) : sayComingSoon(s.label))}
                  className={`btn-press liquid-glass text-left p-card flex flex-col gap-1 min-w-0 ${on ? "" : "text-muted-foreground"}`}
                >
                  <span className="flex items-center justify-between">
                    <span className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                      <Icon className="w-[18px] h-[18px]" aria-hidden />
                    </span>
                    {on ? <ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden /> : <span className="text-ds-11 font-semibold text-muted-foreground">Coming soon</span>}
                  </span>
                  <span className="text-ds-14 min-[360px]:text-ds-16 font-bold mt-2 truncate">{s.label}</span>
                  <span className={`text-ds-24 leading-7 font-bold ${on && tile.n > 0 && s.key === "jobs" ? "text-[hsl(var(--accent-ink))]" : ""}`}>{on ? tile.n : "–"}</span>
                  <span className="text-ds-13 text-muted-foreground truncate">{on ? tile.label : "Not open yet"}</span>
                  <span className="text-ds-13 pt-2 mt-1 border-t border-border/70 truncate">{on ? tile.second : "We'll tell you when"}</span>
                </button>
              );
            })}
          </div>
        </section>

        <GroupSection title="Coming up">
          {summary.upcoming.length === 0 ? (
            <p className="px-4 py-4 text-ds-14 text-muted-foreground">Nothing booked yet.</p>
          ) : (
            summary.upcoming.map((c, i) => (
              <GroupRow
                key={c.id}
                title={c.job.title}
                meta={jobMetaLine(c.job)}
                onClick={() => navigate(`/jobs/${c.job.id}`)}
                right={<span className="text-ds-15 font-bold shrink-0">${c.job.budget}</span>}
                last={i === summary.upcoming.length - 1}
              />
            ))
          )}
        </GroupSection>
      </div>
      <CustomizeSheet open={customize} onOpenChange={setCustomize} />
    </SectionScreen>
  );
}
