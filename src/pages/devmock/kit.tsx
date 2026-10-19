/* MOCK-ONLY kit (wip/dashboards-mock-1019-r2 — never lands). */
import type { ReactNode } from "react";
import { Home, Briefcase, Sofa, Store, KeyRound, MessageSquare, ChevronRight, Search, Plus, type LucideIcon } from "lucide-react";
import { HelprMark } from "@/components/HelprMark";
import { categoryColors } from "@/components/job-card/activityConstants";

export type DockKey = "home" | "jobs" | "declutter" | "shops" | "homes";
const DOCK: { key: DockKey; icon: LucideIcon; label: string; badge?: number }[] = [
  { key: "home", icon: Home, label: "Home" },
  { key: "jobs", icon: Briefcase, label: "Jobs", badge: 6 },
  { key: "declutter", icon: Sofa, label: "Declutter" },
  { key: "shops", icon: Store, label: "Shops" },
  { key: "homes", icon: KeyRound, label: "Homes" },
];

/** Two icons only: messages + profile. Search/filters live in each section's Browse; notifications are the Home "Needs you" list. */
export function TopBar({ unread = 4, title, plus, extra }: { unread?: number; title?: string; plus?: string; extra?: ReactNode }) {
  return (
    <div className="flex items-center justify-between h-14 px-4">
      {title ? <h1 className="text-[26px] leading-8 font-bold tracking-tight truncate">{title}</h1> : <HelprMark size="sm" emblemOnly to="#" />}
      <div className="flex items-center gap-2">
        {extra}
        {plus && (
          <button type="button" aria-label={plus} className="w-10 h-10 rounded-full btn-grad-primary text-primary-foreground flex items-center justify-center">
            <Plus className="w-[22px] h-[22px]" strokeWidth={2.4} />
          </button>
        )}
        <button type="button" aria-label="Messages" className="relative w-10 h-10 rounded-full flex items-center justify-center text-foreground">
          <MessageSquare className="w-[22px] h-[22px]" />
          {unread > 0 && (
            <span className="absolute top-0.5 right-0 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-accent-foreground text-[11px] font-bold flex items-center justify-center">{unread}</span>
          )}
        </button>
        <button type="button" aria-label="Profile" className="w-9 h-9 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center">L</button>
      </div>
    </div>
  );
}

export function Dock({ active }: { active: DockKey }) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-50 pb-3 px-3">
      <div className="mx-auto max-w-lg rounded-full border border-border bg-card shadow-[0_4px_16px_-6px_hsl(var(--olivewood)/0.18)] flex h-14 px-1.5">
        {DOCK.map(({ key, icon: Icon, label, badge }) => {
          const on = key === active;
          return (
            <div key={key} className="flex-1 flex flex-col items-center justify-center relative">
              <span className={`relative flex items-center justify-center w-14 h-10 rounded-full ${on ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}>
                <Icon className="w-[22px] h-[22px]" strokeWidth={on ? 2.4 : 1.8} />
                {badge && !on ? <span className="absolute top-0 right-2 min-w-[16px] h-4 px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-bold flex items-center justify-center">{badge}</span> : null}
              </span>
              <span className="sr-only">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Frame({ dock, children, topBar = true, title, plus, extra, overlay }: { dock: DockKey; children: ReactNode; topBar?: boolean; title?: string; plus?: string; extra?: ReactNode; overlay?: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans pb-28">
      <div className="mx-auto max-w-lg">
        {topBar && <TopBar title={title} plus={plus} extra={extra} />}
        <div className="px-4 flex flex-col gap-5">{children}</div>
      </div>
      <Dock active={dock} />
      {overlay}
    </div>
  );
}

export function PageTitle({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 pt-1">
      <div className="min-w-0">
        <h1 className="text-[26px] leading-8 font-bold tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Pill({ children, outline = false }: { children: ReactNode; outline?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-semibold whitespace-nowrap ${outline ? "border border-border bg-card text-foreground" : "btn-grad-primary text-primary-foreground"}`}
    >
      {children}
    </span>
  );
}

export function SectionHead({ title, count, link }: { title: string; count?: number | string; link?: string }) {
  return (
    <div className="flex items-baseline justify-between px-1 -mb-2">
      <h2 className="text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {title}
        {count !== undefined && <span className="ml-1.5 text-foreground/70">{count}</span>}
      </h2>
      {link && <span className="text-[13px] font-semibold text-primary">{link}</span>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`liquid-glass overflow-hidden ${className}`}>{children}</div>;
}

/** A list row inside a Card. `tone` colours the leading marker. */
export function Row({
  title, meta, right, icon: Icon, dot, tone = "muted", last = false, tag,
}: {
  title: ReactNode; meta?: ReactNode; right?: ReactNode; icon?: LucideIcon; dot?: string;
  tone?: "accent" | "primary" | "muted"; last?: boolean; tag?: string;
}) {
  const toneCls = tone === "accent" ? "bg-accent/10 text-[hsl(var(--accent-ink))]" : tone === "primary" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground";
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${last ? "" : "border-b border-border/70"}`}>
      {Icon && (
        <span className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${toneCls}`}>
          <Icon className="w-[18px] h-[18px]" />
        </span>
      )}
      {dot && <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${categoryColors[dot]?.dot ?? categoryColors.other.dot}`} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-[15px] font-semibold truncate">{title}</p>
          {tag && <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{tag}</span>}
        </div>
        {meta && <p className="text-[13px] text-muted-foreground truncate mt-0.5">{meta}</p>}
      </div>
      {right ?? <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
    </div>
  );
}

export function Stat({ n, label, tone = "default" }: { n: ReactNode; label: string; tone?: "default" | "accent" }) {
  return (
    <div className="flex-1 min-w-0">
      <p className={`text-[22px] leading-7 font-bold ${tone === "accent" ? "text-[hsl(var(--accent-ink))]" : ""}`}>{n}</p>
      <p className="text-[12px] text-muted-foreground leading-4">{label}</p>
    </div>
  );
}

export function SearchEntry({ placeholder }: { placeholder: string }) {
  return (
    <div className="flex items-center gap-2.5 h-12 px-4 rounded-full border border-border bg-card text-muted-foreground">
      <Search className="w-[18px] h-[18px]" />
      <span className="text-[15px] truncate">{placeholder}</span>
    </div>
  );
}

export function Segmented({ items, active }: { items: string[]; active: number }) {
  return (
    <div className="flex p-1 rounded-full bg-muted">
      {items.map((t, i) => (
        <span key={t} className={`flex-1 text-center h-9 leading-9 rounded-full text-sm font-semibold ${i === active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>{t}</span>
      ))}
    </div>
  );
}

export function SampleBadge() {
  return <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border border-dashed border-accent/60 text-[hsl(var(--accent-ink))]">Sample</span>;
}

export function Money({ children }: { children: ReactNode }) {
  return <span className="text-[15px] font-bold shrink-0">{children}</span>;
}
