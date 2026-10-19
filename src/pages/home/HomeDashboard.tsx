import { useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, ChevronDown } from "lucide-react";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { GroupSection, GroupRow } from "@/components/sections/StatusBoxes";
import { CustomizeSheet } from "@/components/sections/CustomizeSheet";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useSectionTabs, sayComingSoon } from "@/components/mobileNav/useSectionTabs";
import { useNavUnreadCount } from "@/components/mobileNav/useNavUnreadCount";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatJobDate } from "@/lib/dateUtils";
import { useHomeSummary, type ComingUpItem } from "./homeDashboard/useHomeSummary";
import { useTodoOpen } from "./homeDashboard/useTodoOpen";
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
 * HOME (owner final decisions, 2026-10-19): the app opens here. Greeting; three
 * stat boxes (To do / This week / Unread); the To do list, COLLAPSED until the
 * To do box or its header is tapped (remembered for the session only); the
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
  const { unreadCount } = useNavUnreadCount(user);
  const summary = useHomeSummary(user);
  const { visible } = useSectionPrefs();
  const live = useSectionTabs();
  const [todoOpen, toggleTodo] = useTodoOpen();
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

  const stats = [
    { key: "todo", n: todoCount, label: "To do", hot: todoCount > 0, onClick: toggleTodo, pressed: todoOpen },
    { key: "week", n: summary.thisWeek, label: "This week", onClick: () => navigate("/jobs?tab=working&filter=scheduled") },
    { key: "unread", n: unreadCount, label: "Unread", onClick: () => navigate("/messages") },
  ];

  return (
    <SectionScreen>
      <div data-testid="home-dashboard" className="flex flex-col gap-section">
        <div>
          <h1 className="text-page-title text-foreground">{first ? `${greeting()}, ${first}` : greeting()}</h1>
          <p className="text-ds-14 text-muted-foreground mt-0.5">{today}</p>
        </div>

        <div className="liquid-glass flex divide-x divide-border/70" role="group" aria-label="Your day">
          {stats.map((s) => (
            <button
              key={s.key}
              type="button"
              data-stat={s.key}
              aria-expanded={s.key === "todo" ? s.pressed : undefined}
              onClick={s.onClick}
              className="btn-press flex-1 min-w-0 px-2 py-3 text-center"
            >
              <span className={`block text-ds-24 leading-7 font-bold ${s.hot ? "text-[hsl(var(--accent-ink))]" : ""}`}>{s.n}</span>
              <span className="block text-ds-12 text-muted-foreground">{s.label}</span>
            </button>
          ))}
        </div>

        {todoCount > 0 && !todoOpen && (
          <button type="button" data-testid="todo-collapsed" onClick={toggleTodo} aria-expanded={false} className="btn-press liquid-glass flex items-center justify-between px-4 py-3">
            <span className="text-ds-15 font-semibold">To do ({todoCount})</span>
            <ChevronDown className="w-4 h-4 text-muted-foreground" aria-hidden />
          </button>
        )}
        {todoOpen && todoCount > 0 && (
          <div data-testid="todo-list">
            <GroupSection title="To do" count={todoCount} onSeeAll={toggleTodo} seeAllLabel="Hide">
              {summary.todos.slice(0, 3).map((t, i, arr) => (
                <GroupRow key={t.id} title={t.title} meta={t.meta} onClick={() => navigate(t.to)} last={i === arr.length - 1 && todoCount <= 3} />
              ))}
              {todoCount > 3 && <GroupRow title={`See all ${todoCount}`} onClick={() => navigate("/jobs?tab=posted&filter=needs_you")} last />}
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
