import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { formatPrice } from "@/lib/format";
import { ChoicePill } from "@/components/ui/ChoicePill";
import { AdminCard } from "@/components/admin/AdminViewShell";
import { ErrorState } from "@/components/ui/ErrorState";

/** Below this many, a rate or a median is not shown (truth rule: no stat from a handful). */
const MIN_SAMPLE = 5;

type Section = "jobs" | "declutter";
type Days = 7 | 30 | 90;

/** What admin_section_funnel (20261021091636) answers. */
interface FunnelData {
  section: Section;
  days: number;
  stages: { key: string; count: number }[];
  drops: Record<string, number>;
  first_response_minutes: number | null;
  first_response_sample: number;
  rehire: { posters: number; rehired: number } | null;
  released_cents: number;
  parishes: string[];
}

const LABELS: Record<string, string> = {
  started: "Post started",
  posted: "Posted",
  applicant: "First applicant",
  hired: "Hired",
  done: "Done",
  reviewed: "Reviewed",
  listed: "Listed",
  offer: "First offer",
  sold: "Sold",
  handed_over: "Handed over",
};

/** The reason on each stage's row: who dropped on the way INTO it, from real rows only. */
function dropReason(section: Section, key: string, prev: number, count: number, d: Record<string, number>): string | null {
  if (section === "jobs") {
    if (key === "posted") return prev - count > 0 ? `${prev - count} started but didn't post` : null;
    if (key === "applicant") return d.no_applicant_24h ? `${d.no_applicant_24h} got no applicant in 24 h` : null;
    if (key === "hired") return d.never_hired ? `${d.never_hired} never hired` : null;
    if (key === "done") return d.cancelled_after_hire ? `${d.cancelled_after_hire} cancelled after hiring` : null;
    if (key === "reviewed") return d.no_review ? `${d.no_review} skipped the review` : null;
  } else {
    if (key === "offer") return d.no_offer_24h ? `${d.no_offer_24h} got no offer in 24 h` : null;
    if (key === "sold") return d.offer_not_sold ? `${d.offer_not_sold} had offers but didn't sell` : null;
    if (key === "handed_over") return d.not_handed_over ? `${d.not_handed_over} not handed over yet` : null;
    if (key === "reviewed") return d.no_review ? `${d.no_review} skipped the review` : null;
  }
  return null;
}

function duration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 48) return rest ? `${h} h ${rest} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}

const pct = (n: number, of: number) => `${Math.round((100 * n) / of)}%`;

/** The biggest relative drop between two stages, with at least MIN_SAMPLE before it. */
function biggestDrop(stages: FunnelData["stages"]): { i: number; lost: number; prev: number } | null {
  let best: { i: number; lost: number; prev: number; share: number } | null = null;
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].count;
    const lost = prev - stages[i].count;
    if (prev < MIN_SAMPLE || lost <= 0) continue;
    const share = lost / prev;
    if (!best || share > best.share) best = { i, lost, prev, share };
  }
  return best;
}

/**
 * Board 191 (spec v2 §9.35): where people drop off, Jobs or Declutter, over 7,
 * 30 or 90 days and (Jobs) one parish. Every number is counted by
 * admin_section_funnel from real rows; a rate or median from fewer than five is
 * shown as "Not enough yet", never as a number.
 */
export function SectionFunnel() {
  const [section, setSection] = useState<Section>("jobs");
  const [days, setDays] = useState<Days>(30);
  const [parish, setParish] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["admin", "section-funnel", section, days, section === "jobs" ? parish : null],
    queryFn: async () => {
      const res = await supabase.rpc("admin_section_funnel", {
        p_section: section,
        p_days: days,
        p_parish: section === "jobs" ? parish ?? undefined : undefined,
      });
      // Merge-to-deploy window: the function is not on the database yet, so
      // the card stays out rather than showing a failure (CLAUDE.md: PGRST202).
      if (res.error && isMissingRpcNamed(res.error, "admin_section_funnel")) return null;
      return unwrap(res) as unknown as FunnelData;
    },
  });
  if (q.data === null) return null;
  const data = q.data;
  const noun = section === "jobs" ? "Jobs" : "Declutter";

  const controls = (
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Funnel filters">
      <ChoicePill selected={section === "jobs"} onClick={() => setSection("jobs")}>Jobs</ChoicePill>
      <ChoicePill selected={section === "declutter"} onClick={() => setSection("declutter")}>Declutter</ChoicePill>
      <select
        aria-label="Time window"
        className="min-h-11 rounded-full border border-border bg-card px-4 text-ds-13 font-semibold"
        value={days}
        onChange={(e) => setDays(Number(e.target.value) as Days)}
      >
        <option value={7}>Last 7 days</option>
        <option value={30}>Last 30 days</option>
        <option value={90}>Last 90 days</option>
      </select>
      {section === "jobs" && (
        <select
          aria-label="Parish"
          className="min-h-11 rounded-full border border-border bg-card px-4 text-ds-13 font-semibold"
          value={parish ?? ""}
          onChange={(e) => setParish(e.target.value || null)}
        >
          <option value="">All parishes</option>
          {(data?.parishes ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      )}
    </div>
  );

  if (q.isError) {
    return (
      <AdminCard title={`${noun} funnel`} action={controls}>
        <ErrorState title="Couldn't load the funnel" onRetry={() => void q.refetch()} />
      </AdminCard>
    );
  }

  const stages = data?.stages ?? [];
  const top = Math.max(1, ...stages.map((s) => s.count));
  // Jobs: posted (1) -> hired (3). Declutter: listed (0) -> sold (2).
  const posted = (section === "jobs" ? stages[1]?.count : stages[0]?.count) ?? 0;
  const converted = (section === "jobs" ? stages[3]?.count : stages[2]?.count) ?? 0;
  const drop = data ? biggestDrop(stages) : null;
  const notEnough = "Not enough yet";

  return (
    <div className="flex flex-col gap-4" data-testid="section-funnel">
      <AdminCard
        title={`${noun} funnel`}
        subtitle={`Last ${days} days · every number from real ${section === "jobs" ? "jobs" : "listings"}`}
        action={controls}
        surface="none"
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat
            label={section === "jobs" ? "Posted → hired" : "Listed → sold"}
            value={posted >= MIN_SAMPLE ? pct(converted, posted) : notEnough}
            sub={`${converted} of ${posted}`}
          />
          <Stat
            label={section === "jobs" ? "Time to first applicant" : "Time to first offer"}
            value={data && data.first_response_minutes != null && data.first_response_sample >= MIN_SAMPLE ? duration(data.first_response_minutes) : notEnough}
            sub={`median from posting, of ${data?.first_response_sample ?? 0}`}
          />
          {section === "jobs" && (
            <Stat
              label="Rehire rate"
              value={data?.rehire && data.rehire.posters >= MIN_SAMPLE ? pct(data.rehire.rehired, data.rehire.posters) : notEnough}
              sub="all time, every parish: posters who hired the same Helpr again"
            />
          )}
          <Stat
            label={section === "jobs" ? "Released to Helprs" : "Released to sellers"}
            value={data ? `$${formatPrice((data.released_cents ?? 0) / 100)}` : "…"}
            sub={`${days} days`}
            money
          />
        </div>
      </AdminCard>

      <AdminCard title="Where people drop off">
        <div className="flex flex-col divide-y divide-border/60">
          {stages.map((s, i) => {
            const reason = i === 0 ? null : dropReason(section, s.key, stages[i - 1].count, s.count, data?.drops ?? {});
            const isBiggest = drop?.i === i;
            return (
              <div key={s.key} className="grid grid-cols-[8rem_1fr_3rem] sm:grid-cols-[10rem_1fr_3.5rem_minmax(0,16rem)] items-center gap-3 py-2.5" data-funnel-stage={s.key}>
                <span className="text-ds-14 font-semibold text-foreground">{LABELS[s.key] ?? s.key}</span>
                <span className="h-3 rounded-full bg-muted overflow-hidden" aria-hidden>
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${(100 * s.count) / top}%` }} />
                </span>
                <span className="text-ds-14 font-bold tabular-nums text-foreground">{s.count}</span>
                <span
                  className="col-span-3 sm:col-span-1 text-ds-13"
                  style={{ color: isBiggest ? "hsl(var(--alert-ink))" : "hsl(var(--muted-foreground))", fontWeight: isBiggest ? 700 : 400 }}
                >
                  {reason ?? ""}
                </span>
              </div>
            );
          })}
        </div>
      </AdminCard>

      {data && (
        <div className="grid gap-3 sm:grid-cols-2">
          <AdminCard title={drop ? `Biggest drop: ${(LABELS[stages[drop.i].key] ?? "").toLowerCase()}` : "Biggest drop"}>
            <p className="text-ds-14 text-muted-foreground">
              {drop
                ? `${drop.lost} of ${drop.prev} didn't reach ${(LABELS[stages[drop.i].key] ?? "").toLowerCase()} (${pct(drop.lost, drop.prev)}).`
                : `${notEnough}: no step had ${MIN_SAMPLE} or more ${section === "jobs" ? "jobs" : "listings"} before it.`}
            </p>
          </AdminCard>
          <AdminCard title={section === "jobs" ? "No applicant in 24 hours" : "No offer in 24 hours"}>
            <p className="text-ds-14 text-muted-foreground">
              {section === "jobs"
                ? `${data.drops.no_applicant_24h ?? 0} posted job${(data.drops.no_applicant_24h ?? 0) === 1 ? "" : "s"} got no applicant in the first 24 hours.`
                : `${data.drops.no_offer_24h ?? 0} listing${(data.drops.no_offer_24h ?? 0) === 1 ? "" : "s"} got no offer in the first 24 hours.`}
            </p>
          </AdminCard>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, money = false }: { label: string; value: string; sub: string; money?: boolean }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-4 flex flex-col gap-1 min-w-0">
      <span className="text-ds-13 text-muted-foreground">{label}</span>
      {value === "Not enough yet" ? (
        // A word, not a number: never drawn at a stat's size (truth rule).
        <span className="text-ds-15 font-semibold leading-tight text-muted-foreground py-1.5">{value}</span>
      ) : (
        <span className={`text-ds-26 font-bold leading-tight ${money ? "text-[hsl(var(--sienna-ink))]" : "text-foreground"}`}>{value}</span>
      )}
      <span className="text-ds-12 text-muted-foreground">{sub}</span>
    </div>
  );
}
