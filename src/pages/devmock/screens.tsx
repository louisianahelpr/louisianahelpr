/* MOCK-ONLY screens (wip/dashboards-mock-1019-r2 — never lands). */
import type { ReactNode } from "react";
import {
  Briefcase, Sofa, Store, KeyRound, Users, AlertTriangle, CheckCircle2, MessageSquare, Wrench, Package,
  CalendarDays, Clock, Tag, GripVertical, Lock, ShoppingBag, Truck, Search as SearchIcon, Hammer, Home as HomeIcon, Wallet, ChevronRight, Plus,
} from "lucide-react";
import { categoryColors } from "@/components/job-card/activityConstants";
import { Frame, PageTitle, Pill, SectionHead, Card, Row, Stat, SearchEntry, Segmented, SampleBadge, Money } from "./kit";
import { posted, working, declutter, shopSample, homesSample, money, cents, unreadMessages, type MockJob } from "./mockData";

const jobMeta = (j: MockJob) => [j.date, j.time, j.city].filter(Boolean).join(" · ");

export function JobRows({ jobs, noteTone = "muted" }: { jobs: MockJob[]; noteTone?: "accent" | "muted" }) {
  return (
    <>
      {jobs.map((j, i) => (
        <div key={j.title + i} className={`px-4 py-3 ${i === jobs.length - 1 ? "" : "border-b border-border/70"}`}>
          <div className="flex items-center gap-2.5">
            <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${(categoryColors[j.category] ?? categoryColors.other).dot}`} />
            <p className="flex-1 min-w-0 text-[15px] font-semibold truncate">{j.title}</p>
            <Money>{money(j.budget)}</Money>
          </div>
          <p className="text-[13px] text-muted-foreground mt-0.5 pl-5 truncate">{jobMeta(j)}</p>
          {j.note && (
            <p className={`text-[13px] font-medium mt-1 pl-5 ${noteTone === "accent" ? "text-[hsl(var(--accent-ink))]" : "text-foreground/80"}`}>{j.note}</p>
          )}
        </div>
      ))}
    </>
  );
}

export function SampleNote({ what = "shops" }: { what?: string }) {
  return <p className="-mt-2 text-[12px] text-muted-foreground flex items-center gap-1.5"><SampleBadge />Prod has no {what} yet</p>;
}

/* ================= HOME ================= */
const needsYou = [
  { icon: Users, text: "2 people applied to your jobs", meta: "Jobs I posted · pick a helpr", tone: "accent" as const },
  { icon: CheckCircle2, text: "Mark today's job done", meta: "Jobs I'm working · Baton Rouge", tone: "accent" as const },
  { icon: AlertTriangle, text: "6 disputes need your side", meta: "3 posted · 3 working", tone: "accent" as const },
  { icon: Wrench, text: "Urgent: sink leaking", meta: "Homes · Oak St duplex, Unit B", tone: "accent" as const, sample: true },
  { icon: Package, text: "2 shop orders to accept", meta: "Shops · first by 6 PM", tone: "accent" as const, sample: true },
];

const comingUp = [
  { icon: Briefcase, text: "Mow and edge a corner lot", meta: "Sun, Oct 25 · applied, waiting", right: "$95" },
  { icon: Briefcase, text: "Hang shelves and a TV mount", meta: "Sun, Oct 25 · your post, in review", right: "$150" },
  { icon: KeyRound, text: "Rent due — Cypress Lofts", meta: "Nov 1", right: "$1,150", sample: true },
];

function Greeting() {
  return <PageTitle title="Good evening, Lexi" sub="Monday, Oct 19" />;
}

function NeedsYouCard({ limit = 5 }: { limit?: number }) {
  const rows = needsYou.slice(0, limit);
  return (
    <Card>
      {rows.map((r, i) => (
        <Row key={r.text} icon={r.icon} tone={r.tone} title={r.text} meta={r.meta} tag={r.sample ? "Sample" : undefined} last={i === rows.length - 1} />
      ))}
    </Card>
  );
}

const sections = [
  { key: "jobs", icon: Briefcase, name: "Jobs & Posts", a: ["6", "need you"], b: ["9", "in progress"], c: ["4", "working"] },
  { key: "declutter", icon: Sofa, name: "Declutter", a: ["2", "live"], b: ["2", "in review"], c: ["0", "buying"] },
  { key: "shops", icon: Store, name: "Shops", a: ["2", "to accept"], b: ["$184.50", "next payout"], c: ["1", "my order"], sample: true },
  { key: "homes", icon: KeyRound, name: "Homes", a: ["1", "urgent repair"], b: ["1", "rent late"], c: ["Nov 1", "my rent"], sample: true },
];

function SectionTile({ s }: { s: (typeof sections)[number] }) {
  const Icon = s.icon;
  return (
    <Card className="p-4 flex flex-col gap-3">
      <div>
        <div className="flex items-center justify-between">
          <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center"><Icon className="w-[18px] h-[18px]" /></span>
          {s.sample ? <SampleBadge /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
        <p className="text-[15px] font-bold mt-2">{s.name}</p>
      </div>
      <div>
        <p className={`text-[24px] leading-7 font-bold ${s.a[1].includes("need") || s.a[1].includes("accept") || s.a[1].includes("urgent") ? "text-[hsl(var(--accent-ink))]" : ""}`}>{s.a[0]}</p>
        <p className="text-[12px] text-muted-foreground">{s.a[1]}</p>
      </div>
      <p className="text-[12px] text-muted-foreground border-t border-border/70 pt-2 truncate">
        <span className="font-semibold text-foreground">{s.b[0]}</span> {s.b[1]}
      </p>
    </Card>
  );
}

export function HomeA() {
  return (
    <Frame dock="home">
      <Greeting />
      <SectionHead title="Needs you" count={5} />
      <NeedsYouCard />
      <SectionHead title="Your sections" />
      <div className="grid grid-cols-2 gap-3">
        {sections.map((s) => <SectionTile key={s.key} s={s} />)}
      </div>
      <SectionHead title="Coming up" link="Calendar" />
      <Card>
        {comingUp.map((r, i) => (
          <Row key={r.text} icon={r.icon} tone="primary" title={r.text} meta={r.meta} tag={r.sample ? "Sample" : undefined} right={<Money>{r.right}</Money>} last={i === comingUp.length - 1} />
        ))}
      </Card>
    </Frame>
  );
}

function SectionBlock({ icon: Icon, name, stats, children, sample }: { icon: typeof Briefcase; name: string; stats: [string, string, boolean?][]; children?: ReactNode; sample?: boolean }) {
  return (
    <Card>
      <div className="flex items-center gap-2.5 px-4 pt-4">
        <span className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center"><Icon className="w-5 h-5" /></span>
        <p className="text-[17px] font-bold flex-1">{name}</p>
        {sample && <SampleBadge />}
        <span className="text-[13px] font-semibold text-primary flex items-center">Open<ChevronRight className="w-4 h-4" /></span>
      </div>
      <div className="flex gap-3 px-4 py-3">
        {stats.map(([n, l, hot]) => <Stat key={l} n={n} label={l} tone={hot ? "accent" : "default"} />)}
      </div>
      {children && <div className="border-t border-border/70">{children}</div>}
    </Card>
  );
}

function PlusChooser() {
  const items: [typeof Briefcase, string, string][] = [
    [Briefcase, "Post a job", "Jobs & Posts"], [Sofa, "Sell an item", "Declutter"], [Store, "Add a shop item", "Shops"], [KeyRound, "Add a property", "Homes"],
  ];
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/40" />
      <div className="absolute right-4 top-16 w-64 liquid-glass py-1.5">
        {items.map(([Icon, t, sec], i) => (
          <div key={t} className={`flex items-center gap-3 px-4 py-2.5 ${i < items.length - 1 ? "border-b border-border/70" : ""}`}>
            <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center"><Icon className="w-[18px] h-[18px]" /></span>
            <div><p className="text-[15px] font-semibold">{t}</p><p className="text-[12px] text-muted-foreground">{sec}</p></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HomeBPlus() {
  return <HomeB open />;
}

export function HomeB({ open = false }: { open?: boolean }) {
  return (
    <Frame dock="home" plus="Add" overlay={open ? <PlusChooser /> : undefined}>
      <Greeting />
      <Card className="px-4 py-3 flex items-center gap-3">
        <span className="w-10 h-10 rounded-full bg-accent/10 text-[hsl(var(--accent-ink))] flex items-center justify-center"><AlertTriangle className="w-5 h-5" /></span>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold">5 things need you</p>
          <p className="text-[13px] text-muted-foreground truncate">{unreadMessages} unread messages · next: Sun, Oct 25</p>
        </div>
      </Card>
      <SectionBlock icon={Briefcase} name="Jobs & Posts" stats={[["6", "need you", true], ["9", "in progress"], ["18", "done"]]}>
        <Row icon={Users} tone="accent" title="2 people applied" meta="Mow and edge a corner lot · Feed and walk two dogs" />
        <Row icon={CheckCircle2} tone="accent" title="Mark today's job done" meta="Cleaning test job · Baton Rouge" last />
      </SectionBlock>
      <SectionBlock icon={Sofa} name="Declutter" stats={[["2", "live"], ["2", "in review"], ["0", "offers"]]} />
      <SectionBlock icon={Store} name="Shops" sample stats={[["2", "to accept", true], ["$184.50", "payout Fri"], ["1", "my order"]]}>
        <Row icon={Package} tone="accent" title="King cake (large)" meta="Accept by 6 PM · Renee B. · $42" last />
      </SectionBlock>
      <SectionBlock icon={KeyRound} name="Homes" sample stats={[["1", "urgent repair", true], ["1", "rent late"], ["Nov 1", "my rent due"]]}>
        <Row icon={Wrench} tone="accent" title="Sink leaking" meta="Oak St duplex, Unit B · 2 h ago" last />
      </SectionBlock>
    </Frame>
  );
}

export function HomeC() {
  return (
    <Frame dock="home">
      <Greeting />
      <Card className="flex divide-x divide-border/70">
        {[["5", "To do", true], ["2", "This week"], [String(unreadMessages), "Unread"]].map(([n, l, hot]) => (
          <div key={l as string} className="flex-1 px-4 py-3 text-center">
            <p className={`text-[24px] leading-7 font-bold ${hot ? "text-[hsl(var(--accent-ink))]" : ""}`}>{n}</p>
            <p className="text-[12px] text-muted-foreground">{l}</p>
          </div>
        ))}
      </Card>
      <SectionHead title="To do" link="See all 5" />
      <NeedsYouCard limit={3} />
      <SectionHead title="Sections" />
      <Card>
        <Row icon={Briefcase} tone="primary" title="Jobs & Posts" meta="6 need you · 9 in progress · 2 applied" right={<Badge n={6} />} />
        <Row icon={Sofa} tone="primary" title="Declutter" meta="2 live · 2 in review · nothing bought yet" />
        <Row icon={Store} tone="primary" title="Shops" tag="Sample" meta="2 orders to accept · $184.50 payout Fri" right={<Badge n={2} />} />
        <Row icon={KeyRound} tone="primary" title="Homes" tag="Sample" meta="1 urgent repair · rent due Nov 1" right={<Badge n={1} />} last />
      </Card>
    </Frame>
  );
}


type SecKey = "jobs" | "declutter" | "shops" | "homes";
const SECTION_OF_TODO = ["jobs", "jobs", "jobs", "homes", "shops"] as const;

export function HomeD({ hide = [], customize = false }: { hide?: SecKey[]; customize?: boolean }) {
  const todos = needsYou.filter((_, i) => !hide.includes(SECTION_OF_TODO[i]));
  const tiles = sections.filter((s) => !hide.includes(s.key as SecKey));
  const coming = comingUp.filter((r) => !(hide.includes("homes") && r.icon === KeyRound));
  return (
    <Frame dock="home" hide={hide} overlay={customize ? <CustomizeSheet hide={hide} /> : undefined}>
      <Greeting />
      <Card className="flex divide-x divide-border/70">
        {[[String(todos.length), "To do", true], ["2", "This week"], [String(unreadMessages), "Unread"]].map(([n, l, hot]) => (
          <div key={l as string} className="flex-1 px-4 py-3 text-center">
            <p className={`text-[24px] leading-7 font-bold ${hot ? "text-[hsl(var(--accent-ink))]" : ""}`}>{n}</p>
            <p className="text-[12px] text-muted-foreground">{l}</p>
          </div>
        ))}
      </Card>
      <SectionHead title="To do" link={`See all ${todos.length}`} />
      <Card>
        {todos.slice(0, 3).map((r, i, a) => (
          <Row key={r.text} icon={r.icon} tone={r.tone} title={r.text} meta={r.meta} tag={r.sample ? "Sample" : undefined} last={i === a.length - 1} />
        ))}
      </Card>
      <SectionHead title="Your sections" link="Customize" />
      <div className="grid grid-cols-2 gap-3">
        {tiles.map((s, i) => <div key={s.key} className={tiles.length % 2 === 1 && i === tiles.length - 1 ? "col-span-2" : ""}><SectionTile s={s} /></div>)}
      </div>
      <SectionHead title="Coming up" link="Calendar" />
      <Card>
        {coming.map((r, i) => (
          <Row key={r.text} icon={r.icon} tone="primary" title={r.text} meta={r.meta} tag={r.sample ? "Sample" : undefined} right={<Money>{r.right}</Money>} last={i === coming.length - 1} />
        ))}
      </Card>
    </Frame>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span className={`shrink-0 w-12 h-7 rounded-full p-0.5 flex ${on ? "bg-primary justify-end" : "bg-muted justify-start border border-border"}`}>
      <span className="w-6 h-6 rounded-full bg-white shadow-sm" />
    </span>
  );
}

function CustomizeSheet({ hide }: { hide: SecKey[] }) {
  const rows: [SecKey, typeof Briefcase, string][] = [["jobs", Briefcase, "Jobs & Posts"], ["declutter", Sofa, "Declutter"], ["shops", Store, "Shops"], ["homes", KeyRound, "Homes"]];
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-x-0 bottom-0 rounded-t-[28px] bg-card border-t border-border px-4 pt-2.5 pb-8 shadow-[0_-8px_30px_-10px_hsl(var(--olivewood)/0.3)]">
        <div className="mx-auto w-10 h-1.5 rounded-full bg-muted mb-3" />
        <div className="flex items-baseline justify-between">
          <h2 className="text-[20px] font-bold">Customize</h2>
          <span className="text-[15px] font-semibold text-primary">Done</span>
        </div>
        <p className="text-[13px] text-muted-foreground mt-1">Turn off sections you don't use. They leave the bottom bar and Home. Drag to reorder.</p>
        <div className="mt-4 rounded-2xl border border-border overflow-hidden">
          {rows.map(([k, Icon, name], i) => {
            const on = !hide.includes(k);
            return (
              <div key={k} className={`flex items-center gap-3 px-3 py-3 ${i < rows.length - 1 ? "border-b border-border/70" : ""}`}>
                <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className={`w-9 h-9 rounded-full flex items-center justify-center ${on ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}><Icon className="w-[18px] h-[18px]" /></span>
                <p className={`flex-1 text-[15px] font-semibold ${on ? "" : "text-muted-foreground"}`}>{name}</p>
                <Toggle on={on} />
              </div>
            );
          })}
        </div>
        <p className="text-[12px] text-muted-foreground mt-3 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" />Home and Messages always stay. Keep at least one section on.</p>
      </div>
    </div>
  );
}

function Badge({ n }: { n: number }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-accent text-accent-foreground text-[12px] font-bold flex items-center justify-center">{n}</span>
      <ChevronRight className="w-4 h-4 text-muted-foreground" />
    </span>
  );
}

/* ================= JOBS & POSTS ================= */
function StatusTiles({ items }: { items: [string, number, boolean?][] }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map(([l, n, hot], i) => (
        <div key={l} className={`rounded-2xl border px-2 py-2.5 text-center ${i === 0 ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
          <p className={`text-[20px] leading-6 font-bold ${hot ? "text-[hsl(var(--accent-ink))]" : ""}`}>{n}</p>
          <p className="text-[11px] leading-4 text-muted-foreground mt-0.5">{l}</p>
        </div>
      ))}
    </div>
  );
}


export function JobsA() {
  return (
    <Frame dock="jobs" title="Jobs & Posts" plus="Post a job">
      <Segmented items={["Jobs I posted", "Jobs I'm working"]} active={0} />
      <StatusTiles items={[["Needs you", posted.counts.needsYou, true], ["Upcoming", posted.counts.upcoming], ["Working", posted.counts.inProgress], ["Done", posted.counts.done]]} />
      <SectionHead title="Needs you" count={posted.counts.needsYou} link="See all" />
      <Card><JobRows jobs={posted.needsYou} noteTone="accent" /></Card>
      <SectionHead title="Upcoming" count={posted.counts.upcoming} link="See all" />
      <Card><JobRows jobs={posted.upcoming} /></Card>
      <SectionHead title="In progress" count={posted.counts.inProgress} link="See all" />
      <Card><JobRows jobs={posted.inProgress.slice(0, 1)} /></Card>
      <Card>
        <Row icon={CheckCircle2} tone="muted" title="Done" meta="18 finished · 307 cancelled" last />
      </Card>
    </Frame>
  );
}

export function JobsAWorking() {
  return (
    <Frame dock="jobs" title="Jobs & Posts" plus="Post a job">
      <Segmented items={["Jobs I posted", "Jobs I'm working"]} active={1} />
      <SearchEntry placeholder="Find work near you" />
      <StatusTiles items={[["Needs you", working.counts.needsYou, true], ["Applied", working.counts.applied], ["Working", working.counts.inProgress], ["Done", working.counts.done]]} />
      <SectionHead title="Needs you" count={working.counts.needsYou} link="See all" />
      <Card><JobRows jobs={working.needsYou} noteTone="accent" /></Card>
      <SectionHead title="Applied — waiting to hear" count={working.counts.applied} />
      <Card><JobRows jobs={working.applied} /></Card>
      <SectionHead title="Booked" count={working.counts.upcoming} />
      <Card><JobRows jobs={working.upcoming} /></Card>
      <Card>
        <Row icon={CheckCircle2} tone="muted" title="Done" meta="16 finished · 18 not picked" last />
      </Card>
    </Frame>
  );
}

function SideCard({ title, icon: Icon, rows, preview }: { title: string; icon: typeof Briefcase; rows: [string, number, boolean?][]; preview: MockJob }) {
  return (
    <Card>
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-2">
        <span className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center"><Icon className="w-5 h-5" /></span>
        <p className="text-[17px] font-bold flex-1">{title}</p>
        <span className="text-[13px] font-semibold text-primary">See all</span>
      </div>
      <div className="mx-4 mb-3 rounded-2xl bg-accent/10 px-3 py-2.5">
        <p className="text-[12px] font-bold uppercase tracking-wide text-[hsl(var(--accent-ink))]">Next up</p>
        <p className="text-[15px] font-semibold truncate mt-0.5">{preview.title}</p>
        <p className="text-[13px] text-foreground/80 truncate">{preview.note}</p>
      </div>
      {rows.map(([l, n, hot], i) => (
        <Row key={l} title={l} last={i === rows.length - 1}
          right={<span className="flex items-center gap-1"><span className={`text-[15px] font-bold ${hot ? "text-[hsl(var(--accent-ink))]" : ""}`}>{n}</span><ChevronRight className="w-4 h-4 text-muted-foreground" /></span>} />
      ))}
    </Card>
  );
}

export function JobsB() {
  return (
    <Frame dock="jobs" title="Jobs & Posts" plus="Post a job">
      <SearchEntry placeholder="Find work near you" />
      <SideCard title="Jobs I posted" icon={ClipboardIcon} preview={posted.needsYou[0]}
        rows={[["Needs you", posted.counts.needsYou, true], ["Upcoming", posted.counts.upcoming], ["In progress", posted.counts.inProgress], ["Done", posted.counts.done]]} />
      <SideCard title="Jobs I'm working" icon={Hammer} preview={working.needsYou[0]}
        rows={[["Needs you", working.counts.needsYou, true], ["Applied, waiting", working.counts.applied], ["Booked & in progress", working.counts.upcoming + working.counts.inProgress], ["Done", working.counts.done]]} />
    </Frame>
  );
}

function ClipboardIcon(props: { className?: string }) {
  return <Briefcase {...props} />;
}

export function JobsC() {
  return (
    <Frame dock="jobs" title="Jobs & Posts" plus="Post a job">
      <Card className="flex divide-x divide-border/70">
        {[["Posted", "6 need you", "33 active"], ["Working", "4 need you", "14 active"]].map(([t, a, b], i) => (
          <div key={t} className={`flex-1 px-4 py-3 ${i === 0 ? "bg-primary/10" : ""}`}>
            <p className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">{t}</p>
            <p className="text-[17px] font-bold text-[hsl(var(--accent-ink))] mt-0.5">{a}</p>
            <p className="text-[12px] text-muted-foreground">{b}</p>
          </div>
        ))}
      </Card>
      <SectionHead title="Jobs I posted · needs you" count={6} />
      <Card><JobRows jobs={posted.needsYou.slice(0, 2)} noteTone="accent" /></Card>
      <SectionHead title="Jobs I'm working · needs you" count={4} />
      <Card><JobRows jobs={working.needsYou} noteTone="accent" /></Card>
      <Card>
        <Row icon={CalendarDays} tone="primary" title="Upcoming" meta="7 posted · 3 working" />
        <Row icon={Clock} tone="primary" title="In progress" meta="9 posted · 9 working" />
        <Row icon={CheckCircle2} tone="muted" title="Done" meta="18 posted · 16 working" />
        <Row icon={SearchIcon} tone="primary" title="Find work" meta="Browse open jobs near you" last />
      </Card>
    </Frame>
  );
}

/* ================= DECLUTTER ================= */

function PartTile({ icon: Icon, name, big, small, hot }: { icon: typeof Tag; name: string; big: string; small: string; hot?: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="w-[18px] h-[18px] text-primary" />
        <p className="text-[15px] font-bold flex-1">{name}</p>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </div>
      <p className={`text-[22px] leading-7 font-bold mt-2 ${hot ? "text-[hsl(var(--accent-ink))]" : ""}`}>{big}</p>
      <p className="text-[12px] text-muted-foreground truncate">{small}</p>
    </Card>
  );
}

export function Thumb() {
  return <span className="shrink-0 w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-muted-foreground"><Sofa className="w-5 h-5" /></span>;
}

export function ListingRows() {
  const rows = declutter.selling.slice(0, 3);
  return (
    <Card>
      {rows.map((it, i) => (
        <div key={it.title} className={`flex items-center gap-3 px-4 py-3 ${i === rows.length - 1 ? "" : "border-b border-border/70"}`}>
          <Thumb />
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-semibold truncate">{it.title}</p>
            <p className="text-[13px] text-muted-foreground truncate">{it.note}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[15px] font-bold">{money(it.price)}</p>
            <p className={`text-[11px] font-bold uppercase tracking-wide ${it.status === "Live" ? "text-primary" : "text-muted-foreground"}`}>{it.status}</p>
          </div>
        </div>
      ))}
    </Card>
  );
}

export function DeclutterA() {
  return (
    <Frame dock="declutter" title="Declutter" plus="Sell an item">
      <SearchEntry placeholder="Browse items · any distance" />
      <div className="grid grid-cols-2 gap-3">
        <PartTile icon={ShoppingBag} name="Buying" big="0" small="orders · 0 offers out" />
        <PartTile icon={Tag} name="Selling" big="4" small="2 live · 2 in review" />
        <PartTile icon={SearchIcon} name="Wanted" big="0" small="things you want" />
        <PartTile icon={Truck} name="Deliver" big="0" small="delivery runs" />
      </div>
      <SectionHead title="Selling" count={4} link="See all" />
      <ListingRows />
      <SectionHead title="New near you" link="Browse" />
      <div className="grid grid-cols-2 gap-3">
        {declutter.nearby.map((n, i) => (
          <Card key={i}>
            <div className="aspect-[4/3] bg-muted flex items-center justify-center text-muted-foreground"><Sofa className="w-8 h-8" /></div>
            <div className="px-3 py-2.5">
              <p className="text-[14px] font-semibold truncate">{n.title}</p>
              <p className="text-[13px] text-muted-foreground"><span className="font-bold text-foreground">{money(n.price)}</span> · {n.area}</p>
            </div>
          </Card>
        ))}
      </div>
    </Frame>
  );
}

export function DeclutterB() {
  return (
    <Frame dock="declutter" title="Declutter" plus="Sell an item">
      <Segmented items={["My stuff", "Browse"]} active={0} />
      <SectionHead title="Selling" count={4} />
      <ListingRows />
      <SectionHead title="Buying" count={0} />
      <Card><Row icon={ShoppingBag} tone="muted" title="Nothing bought yet" meta="Orders and offers you make show here" right={<span className="text-[13px] font-semibold text-primary">Browse</span>} last /></Card>
      <SectionHead title="Wanted" count={0} />
      <Card><Row icon={SearchIcon} tone="muted" title="Looking for something?" meta="Post a wanted note — sellers near you see it" right={<span className="text-[13px] font-semibold text-primary">Post</span>} last /></Card>
      <SectionHead title="Deliver" count={0} />
      <Card><Row icon={Truck} tone="muted" title="Deliver items for pay" meta="Runs near you show here" right={<span className="text-[13px] font-semibold text-primary">Start</span>} last /></Card>
    </Frame>
  );
}

/* ================= SHOPS (SAMPLE) ================= */
export function ShopsA() {
  const s = shopSample;
  return (
    <Frame dock="shops" title="Shops" plus="Add an item">
      <SampleNote />
      <Segmented items={["Shopping", "My shop"]} active={1} />
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <p className="text-[17px] font-bold flex-1">{s.shop.name}</p>
          <span className="text-[11px] font-bold uppercase tracking-wide text-primary">Open</span>
        </div>
        <div className="flex gap-3 mt-3">
          <Stat n="2" label="to accept" tone="accent" />
          <Stat n="1" label="to make" />
          <Stat n={cents(s.payouts.pendingCents)} label={`payout ${s.payouts.nextDate.split(",")[0]}`} />
        </div>
      </Card>
      <SectionHead title="Orders to fulfill" count={3} link="All orders" />
      <Card>
        {s.toFulfill.map((o, i) => (
          <Row key={o.title} icon={Package} tone={o.status === "held" ? "accent" : "primary"} title={o.title} meta={`${o.buyer} · ${o.note}`} right={<Money>{money(o.total)}</Money>} last={i === s.toFulfill.length - 1} />
        ))}
      </Card>
      <SectionHead title="Shop" />
      <Card>
        <Row icon={Tag} tone="primary" title="Items" meta={`${s.items.live} live · ${s.items.review} in review · ${s.items.soldOut} sold out`} />
        <Row icon={Wallet} tone="primary" title="Payouts" meta={`${cents(s.payouts.monthCents)} this month · next ${s.payouts.nextDate}`} />
        <Row icon={Store} tone="primary" title="Shop settings" meta="Hours, pickup, cancel policy" last />
      </Card>
    </Frame>
  );
}

export function ShopsABuyer() {
  const s = shopSample;
  return (
    <Frame dock="shops" title="Shops" plus="Add an item">
      <SampleNote />
      <Segmented items={["Shopping", "My shop"]} active={0} />
      <SearchEntry placeholder="Search local shops & makers" />
      <SectionHead title="My orders" count={1} link="All" />
      <Card>
        {s.buyerOrders.map((o) => <Row key={o.title} icon={ShoppingBag} tone="primary" title={o.title} meta={`${o.shop} · ${o.status} · ${o.when}`} right={<Money>{money(o.total)}</Money>} last />)}
      </Card>
      <SectionHead title="Near you" link="Browse" />
      <Card>
        {s.nearbyShops.map((n, i) => <Row key={n.name} icon={Store} tone="muted" title={n.name} meta={`${n.kind} · ${n.area}`} last={i === s.nearbyShops.length - 1} />)}
      </Card>
    </Frame>
  );
}

/* ================= HOMES (SAMPLE) ================= */
export function HomesA() {
  const l = homesSample.landlord;
  const t = homesSample.tenant;
  return (
    <Frame dock="homes" title="Homes" plus="Add a property">
      <SampleNote what="homes" />
      <SectionHead title="Repairs to handle" count={2} link="All" />
      <Card>
        {l.repairs.map((r, i) => (
          <Row key={r.description} icon={Wrench} tone={r.urgency === "urgent" ? "accent" : "primary"} title={r.description}
            meta={`${r.property_label}${r.unit_label ? ", " + r.unit_label : ""} · ${r.age}`} tag={r.urgency === "urgent" ? "Urgent" : undefined} last={i === l.repairs.length - 1} />
        ))}
      </Card>
      <SectionHead title="Rent · Nov" />
      <Card className="p-4">
        <div className="flex gap-3">
          <Stat n={`${l.rent.paid} of 3`} label="paid" />
          <Stat n={cents(l.rent.collectedCents)} label={`of ${cents(l.rent.totalCents)}`} />
          <Stat n="1" label="late" tone="accent" />
        </div>
      </Card>
      <SectionHead title="My properties" count={2} />
      <Card>
        {l.properties.map((p, i) => <Row key={p.label} icon={HomeIcon} tone="primary" title={p.label} meta={`${p.units} unit${p.units > 1 ? "s" : ""} · rent ${p.rent.toLowerCase()}`} last={i === l.properties.length - 1} />)}
      </Card>
      <SectionHead title="Where I rent" />
      <Card>
        <Row icon={KeyRound} tone="primary" title={`${t.lease.property}, ${t.lease.unit}`} meta={`${cents(t.lease.rentCents)} due ${t.lease.due} · lease to ${t.lease.ends}`} right={<Pill>Pay rent</Pill>} />
        <Row icon={Wrench} tone="muted" title="Request a repair" meta="Hall light flickers — fixed? Tell us" last />
      </Card>
    </Frame>
  );
}

export function HomesB() {
  const t = homesSample.tenant;
  return (
    <Frame dock="homes" title="Homes">
      <SampleNote what="homes" />
      <Segmented items={["I own", "I rent"]} active={1} />
      <Card className="p-4">
        <p className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">My lease</p>
        <p className="text-[19px] font-bold mt-1">{t.lease.property}, {t.lease.unit}</p>
        <p className="text-[13px] text-muted-foreground">Landlord {t.lease.landlord} · to {t.lease.ends}</p>
        <div className="flex items-center justify-between mt-4 rounded-2xl bg-primary/10 px-3 py-3">
          <div>
            <p className="text-[22px] leading-7 font-bold">{cents(t.lease.rentCents)}</p>
            <p className="text-[12px] text-muted-foreground">due {t.lease.due}</p>
          </div>
          <Pill>Pay rent</Pill>
        </div>
      </Card>
      <SectionHead title="Repairs" count={1} />
      <Card>
        <Row icon={Wrench} tone="accent" title="Hall light flickers" meta="Done Mon — is it fixed? Tell us" last />
      </Card>
      <div><Pill outline><Wrench className="w-4 h-4" />Request a repair</Pill></div>
      <Card><Row icon={MessageSquare} tone="primary" title={`Message ${t.lease.landlord}`} meta="Your landlord" last /></Card>
    </Frame>
  );
}

export const SCREENS: Record<string, () => JSX.Element> = {
  "home-a": HomeA, "home-b": () => <HomeB />, "home-b-plus": HomeBPlus, "home-c": HomeC, "home-d": () => <HomeD />, "home-d-customize": () => <HomeD hide={["homes"]} customize />, "home-d-no-homes": () => <HomeD hide={["homes"]} />,
  "jobs-a": JobsA, "jobs-a-working": JobsAWorking, "jobs-b": JobsB, "jobs-c": JobsC,
  "declutter-a": DeclutterA, "declutter-b": DeclutterB,
  "shops-a": ShopsA, "shops-a-buyer": ShopsABuyer,
  "homes-a": HomesA, "homes-b": HomesB,
};
