/* MOCK-ONLY v2 (owner picked Jobs A, 10-19): every section = "Browse | <my sides>" toggle + status boxes that FILTER. */
import type { ReactNode } from "react";
import { CheckCircle2, Package, Tag, Wallet, Store, Wrench, Home as HomeIcon, SlidersHorizontal, Sofa, MapPin, KeyRound, BedDouble, Eye, Share2 } from "lucide-react";
import { Frame, SectionHead, Card, Row, SearchEntry, Segmented, Money } from "./kit";
import { JobRows, SampleNote, ListingRows } from "./screens";
import { posted, working, declutter, shopSample, homesSample, money, cents, type MockJob } from "./mockData";

/** Status boxes = filters. `sel` = selected index (only that group shows) or null (all groups). */
function FilterBoxes({ items, sel }: { items: [string, number, boolean?][]; sel: number | null }) {
  return (
    <div className="grid grid-cols-4 gap-2" role="group" aria-label="Filter by status">
      {items.map(([l, n, hot], i) => {
        const on = sel === i;
        return (
          <div key={l} aria-pressed={on} className={`rounded-2xl border px-1.5 py-2.5 text-center ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>
            <p className={`text-[20px] leading-6 font-bold ${!on && hot ? "text-[hsl(var(--accent-ink))]" : ""}`}>{n}</p>
            <p className={`text-[10px] min-[360px]:text-[11px] leading-4 mt-0.5 whitespace-nowrap ${on ? "text-primary-foreground/90" : "text-muted-foreground"}`}>{l}</p>
          </div>
        );
      })}
    </div>
  );
}

function FilteredHint({ label }: { label: string }) {
  return <p className="-mt-2 text-[13px] text-muted-foreground px-1">Showing only <span className="font-semibold text-foreground">{label}</span> · tap it again to show all</p>;
}

function BrowseBar({ placeholder, meta }: { placeholder: string; meta: string }) {
  return (
    <>
      <div className="flex gap-2">
        <div className="flex-1 min-w-0"><SearchEntry placeholder={placeholder} /></div>
        <span aria-label="Filters" className="shrink-0 w-12 h-12 rounded-full border border-border bg-card flex items-center justify-center text-foreground">
          <SlidersHorizontal className="w-[18px] h-[18px]" />
        </span>
      </div>
      <p className="-mt-2 px-1 text-[13px] text-muted-foreground">{meta}</p>
    </>
  );
}

function Group({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <>
      <SectionHead title={title} count={count} />
      {children}
    </>
  );
}

/* ================= JOBS ================= */
const JOBS_TABS = ["Browse", "Jobs I posted", "Jobs I'm working"];

function JobFeed({ jobs }: { jobs: MockJob[] }) {
  return (
    <div className="flex flex-col gap-3">
      {jobs.map((j) => (
        <Card key={j.title}>
          <JobRows jobs={[{ ...j, note: undefined }]} />
        </Card>
      ))}
    </div>
  );
}

// Real open jobs from prod (the browse feed's SEED rows; fixtures left out).
const browseJobs: MockJob[] = [
  { title: "Haul storm debris — crew", category: "storm_prep", budget: 300, date: "Sun, Oct 25", city: "Lafayette" },
  { title: "Feed and walk two dogs", category: "pet_care", budget: 160, date: "Sun, Oct 25", city: "Lafayette" },
  { title: "Deep clean a kitchen", category: "cleaning", budget: 120, date: "Wed, Nov 11", city: "Lafayette" },
  { title: "Mow and edge a corner lot", category: "yard_work", budget: 95, date: "Sun, Oct 25", city: "Lafayette" },
];

export function JobsBrowse() {
  return (
    <Frame dock="jobs" title="Jobs & Posts" plus="Post a job">
      <Segmented items={JOBS_TABS} active={0} />
      <BrowseBar placeholder="Search jobs" meta="4 open jobs · any distance" />
      <JobFeed jobs={browseJobs} />
    </Frame>
  );
}

const postedBoxes: [string, number, boolean?][] = [["Needs you", posted.counts.needsYou, true], ["Upcoming", posted.counts.upcoming], ["Working", posted.counts.inProgress], ["Done", posted.counts.done]];

export function JobsPosted({ sel = null }: { sel?: number | null }) {
  return (
    <Frame dock="jobs" title="Jobs & Posts" plus="Post a job">
      <Segmented items={JOBS_TABS} active={1} />
      <FilterBoxes items={postedBoxes} sel={sel} />
      {sel === 0 && <FilteredHint label="Needs you" />}
      {(sel === null || sel === 0) && (
        <Group title="Needs you" count={posted.counts.needsYou}>
          <Card><JobRows jobs={sel === 0 ? [...posted.needsYou, { title: "Handyman fixture job", category: "handyman", budget: 25, date: "Thu, Nov 12", city: "Baton Rouge", note: "Dispute open — add your side" }] : posted.needsYou} noteTone="accent" /></Card>
        </Group>
      )}
      {sel === null && (
        <>
          <Group title="Upcoming" count={posted.counts.upcoming}><Card><JobRows jobs={posted.upcoming.slice(0, 2)} /></Card></Group>
          <Group title="In progress" count={posted.counts.inProgress}><Card><JobRows jobs={posted.inProgress.slice(0, 1)} /></Card></Group>
          <Card><Row icon={CheckCircle2} tone="muted" title="Done" meta="18 finished · 307 cancelled" last /></Card>
        </>
      )}
    </Frame>
  );
}

export function JobsWorking() {
  return (
    <Frame dock="jobs" title="Jobs & Posts" plus="Post a job">
      <Segmented items={JOBS_TABS} active={2} />
      <FilterBoxes items={[["Needs you", working.counts.needsYou, true], ["Applied", working.counts.applied], ["Working", working.counts.inProgress], ["Done", working.counts.done]]} sel={null} />
      <Group title="Needs you" count={working.counts.needsYou}><Card><JobRows jobs={working.needsYou} noteTone="accent" /></Card></Group>
      <Group title="Applied — waiting to hear" count={working.counts.applied}><Card><JobRows jobs={working.applied} /></Card></Group>
      <Group title="Booked" count={working.counts.upcoming}><Card><JobRows jobs={working.upcoming} /></Card></Group>
      <Card><Row icon={CheckCircle2} tone="muted" title="Done" meta="16 finished · 18 not picked" last /></Card>
    </Frame>
  );
}

/* ================= DECLUTTER ================= */
const DECL_TABS = ["Browse", "Buying", "Selling"];

export function DeclutterBrowse() {
  return (
    <Frame dock="declutter" title="Declutter" plus="Sell an item">
      <Segmented items={DECL_TABS} active={0} />
      <BrowseBar placeholder="Search items" meta="2 items for sale · any distance" />
      <div className="grid grid-cols-2 gap-3">
        {declutter.nearby.map((n, i) => (
          <Card key={i}>
            <div className="aspect-square bg-muted flex items-center justify-center text-muted-foreground"><Sofa className="w-9 h-9" /></div>
            <div className="px-3 py-2.5">
              <p className="text-[14px] font-semibold truncate">{n.title}</p>
              <p className="text-[13px] text-muted-foreground"><span className="font-bold text-foreground">{money(n.price)}</span> · {n.area}</p>
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <Row icon={MapPin} tone="primary" title="Can't find it? Post a Wanted" meta="Sellers near you see what you're looking for" last />
      </Card>
    </Frame>
  );
}

export function DeclutterSelling() {
  return (
    <Frame dock="declutter" title="Declutter" plus="Sell an item">
      <Segmented items={DECL_TABS} active={2} />
      <FilterBoxes items={[["Offers", 0, true], ["Live", 2], ["In review", 2], ["Sold", 0]]} sel={null} />
      <Group title="Offers to answer" count={0}>
        <Card><Row icon={Tag} tone="muted" title="No offers yet" meta="Offers on your items show here" right={<span />} last /></Card>
      </Group>
      <Group title="Live" count={2}><ListingRowsFiltered status="Live" /></Group>
      <Group title="In review" count={2}><ListingRowsFiltered status="In review" /></Group>
      <Card><Row icon={Package} tone="muted" title="Sold & deliveries" meta="Nothing sold yet · 0 deliveries to hand over" last /></Card>
    </Frame>
  );
}

function ListingRowsFiltered({ status }: { status: string }) {
  void ListingRows;
  const rows = declutter.selling.filter((r) => r.status === status);
  return (
    <Card>
      {rows.map((it, i) => (
        <div key={it.title} className={`flex items-center gap-3 px-4 py-3 ${i === rows.length - 1 ? "" : "border-b border-border/70"}`}>
          <span className="shrink-0 w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-muted-foreground"><Sofa className="w-5 h-5" /></span>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-semibold truncate">{it.title}</p>
            <p className="text-[13px] text-muted-foreground truncate">{it.note}</p>
          </div>
          <Money>{money(it.price)}</Money>
        </div>
      ))}
    </Card>
  );
}

/* ================= SHOPS (SAMPLE) ================= */
const SHOP_TABS = ["Browse", "My orders", "My shop"];

export function ShopsBrowse() {
  const items = [
    { t: "King cake (large)", shop: "Bayou Bakes", p: 42 },
    { t: "Fig & cane candle", shop: "Magnolia Candles", p: 18 },
    { t: "Pepper jelly ×2", shop: "Cajun Pepper Co.", p: 16 },
    { t: "Pecan pralines ×12", shop: "Bayou Bakes", p: 24 },
  ];
  return (
    <Frame dock="shops" title="Shops" plus="Add an item">
      <SampleNote what="shops" />
      <Segmented items={SHOP_TABS} active={0} />
      <BrowseBar placeholder="Search shops & makers" meta="3 shops near Lafayette" />
      <div className="grid grid-cols-2 gap-3">
        {items.map((n) => (
          <Card key={n.t}>
            <div className="aspect-square bg-muted flex items-center justify-center text-muted-foreground"><Store className="w-9 h-9" /></div>
            <div className="px-3 py-2.5">
              <p className="text-[14px] font-semibold truncate">{n.t}</p>
              <p className="text-[13px] text-muted-foreground truncate"><span className="font-bold text-foreground">{money(n.p)}</span> · {n.shop}</p>
            </div>
          </Card>
        ))}
      </div>
    </Frame>
  );
}

export function ShopsMine() {
  const s = shopSample;
  return (
    <Frame dock="shops" title="Shops" plus="Add an item">
      <SampleNote what="shops" />
      <Segmented items={SHOP_TABS} active={2} />
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <p className="text-[17px] font-bold flex-1 truncate">{s.shop.name}</p>
          <span className="text-[11px] font-bold uppercase tracking-wide text-primary">Open now</span>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <span className="h-10 rounded-full border border-border bg-card flex items-center justify-center gap-1.5 text-[14px] font-semibold"><Eye className="w-4 h-4" />See my shop</span>
          <span className="h-10 rounded-full border border-border bg-card flex items-center justify-center gap-1.5 text-[14px] font-semibold"><Share2 className="w-4 h-4" />Share my shop</span>
        </div>
      </Card>
      <FilterBoxes items={[["To accept", 2, true], ["To make", 1], ["Ready", 0], ["Done", 14]]} sel={null} />
      <Group title="To accept" count={2}>
        <Card>
          {s.toFulfill.filter((o) => o.status === "held").map((o, i) => (
            <Row key={o.title} icon={Package} tone="accent" title={o.title} meta={`${o.buyer} · ${o.note}`} right={<Money>{money(o.total)}</Money>} last={i === 1} />
          ))}
        </Card>
      </Group>
      <Group title="To make" count={1}>
        <Card>{s.toFulfill.filter((o) => o.status === "accepted").map((o) => <Row key={o.title} icon={Package} tone="primary" title={o.title} meta={`${o.buyer} · ${o.note}`} right={<Money>{money(o.total)}</Money>} last />)}</Card>
      </Group>
      <Group title="Shop">
        <Card>
          <Row icon={Wallet} tone="primary" title={`${cents(s.payouts.pendingCents)} payout ${s.payouts.nextDate}`} meta={`${cents(s.payouts.monthCents)} this month`} />
          <Row icon={Tag} tone="primary" title="Items" meta={`${s.items.live} live · ${s.items.review} in review · ${s.items.soldOut} sold out`} />
          <Row icon={Store} tone="primary" title="Shop settings" meta="Hours, pickup, cancel policy" last />
        </Card>
      </Group>
    </Frame>
  );
}

/* ================= HOMES (SAMPLE) ================= */
const HOME_TABS = ["Browse", "I rent", "I own"];

export function HomesBrowse() {
  const listings = [
    { t: "2 bed duplex, Oak St", a: "Lafayette", p: 1150, beds: "2 bd · 1 ba" },
    { t: "Garden cottage", a: "Youngsville", p: 950, beds: "1 bd · 1 ba" },
    { t: "Cypress Lofts, Apt 5", a: "Lafayette", p: 1300, beds: "2 bd · 2 ba" },
  ];
  return (
    <Frame dock="homes" title="Homes" plus="Add a property">
      <p className="-mt-2 text-[12px] text-muted-foreground">Sample — rent listings aren't in the data model yet</p>
      <Segmented items={HOME_TABS} active={0} />
      <BrowseBar placeholder="Search homes for rent" meta="3 homes for rent near you" />
      <div className="flex flex-col gap-3">
        {listings.map((l) => (
          <Card key={l.t} className="flex">
            <div className="w-28 shrink-0 bg-muted flex items-center justify-center text-muted-foreground"><HomeIcon className="w-8 h-8" /></div>
            <div className="flex-1 min-w-0 px-4 py-3">
              <p className="text-[15px] font-semibold truncate">{l.t}</p>
              <p className="text-[13px] text-muted-foreground truncate flex items-center gap-1"><BedDouble className="w-3.5 h-3.5" />{l.beds} · {l.a}</p>
              <p className="text-[15px] font-bold mt-1">{money(l.p)}<span className="text-[13px] font-medium text-muted-foreground">/mo</span></p>
            </div>
          </Card>
        ))}
      </div>
    </Frame>
  );
}

export function HomesOwn() {
  const l = homesSample.landlord;
  return (
    <Frame dock="homes" title="Homes" plus="Add a property">
      <SampleNote what="homes" />
      <Segmented items={HOME_TABS} active={2} />
      <FilterBoxes items={[["Repairs", 2, true], ["Rent late", 1, true], ["Properties", 2], ["Tenants", 3]]} sel={null} />
      <Group title="Repairs to handle" count={2}>
        <Card>
          {l.repairs.map((r, i) => (
            <Row key={r.description} icon={Wrench} tone={r.urgency === "urgent" ? "accent" : "primary"} title={r.description}
              meta={`${r.property_label}${r.unit_label ? ", " + r.unit_label : ""} · ${r.age}`} tag={r.urgency === "urgent" ? "Urgent" : undefined} last={i === l.repairs.length - 1} />
          ))}
        </Card>
      </Group>
      <Group title="Rent · Nov" count={undefined}>
        <Card>
          <Row icon={KeyRound} tone="accent" title="Oak St duplex, Unit A — late" meta="$950 due Nov 1 · remind tenant" right={<Money>$950</Money>} />
          <Row icon={CheckCircle2} tone="primary" title="2 of 3 paid" meta={`${cents(l.rent.collectedCents)} of ${cents(l.rent.totalCents)} collected`} last />
        </Card>
      </Group>
      <Group title="My properties" count={2}>
        <Card>
          {l.properties.map((p, i) => <Row key={p.label} icon={HomeIcon} tone="primary" title={p.label} meta={`${p.units} unit${p.units > 1 ? "s" : ""} · ${p.tenants} tenant${p.tenants > 1 ? "s" : ""}`} last={i === l.properties.length - 1} />)}
        </Card>
      </Group>
    </Frame>
  );
}

export const SCREENS_V2: Record<string, () => JSX.Element> = {
  "v2-jobs-browse": JobsBrowse,
  "v2-jobs-posted": () => <JobsPosted />,
  "v2-jobs-posted-needs": () => <JobsPosted sel={0} />,
  "v2-jobs-working": JobsWorking,
  "v2-declutter-browse": DeclutterBrowse,
  "v2-declutter-selling": DeclutterSelling,
  "v2-shops-browse": ShopsBrowse,
  "v2-shops-mine": ShopsMine,
  "v2-homes-browse": HomesBrowse,
  "v2-homes-own": HomesOwn,
};
