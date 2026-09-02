import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Gift, Users, DollarSign, Banknote, Copy } from "lucide-react";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { formatShortDate, formatPriceExact } from "@/lib/format";
import { AdminViewShell, AdminCard, AdminFilterStrip } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";

/**
 * NOTE ON THE NULLABLE OWNER COLUMNS BELOW.
 *
 * `referral_codes.user_id` and `referrals.referrer_id` are nullable as of
 * 20260901033011 / 20260902014651. Account deletion ANONYMISES these rows
 * rather than removing them — the referral itself is real history and the
 * referee's credit depends on it surviving, so the row stays and the owner
 * link is nulled.
 *
 * They were typed non-null here, which is how `user_id.slice(0, 8)` below
 * survived review: it reads as a safe fallback and is in fact the crash. The
 * first account deletion would have thrown on this page.
 */
interface ReferralCode {
  id: string;
  code: string;
  user_id: string | null;
  created_at: string;
  userName?: string;
}

interface Referral {
  id: string;
  referrer_id: string | null;
  referred_id: string;
  referral_code_id: string;
  created_at: string;
  referrerName?: string;
  referredName?: string;
}

interface ReferralCredit {
  id: string;
  user_id: string;
  amount: number;
  reason: string;
  redeemed: boolean;
  created_at: string;
  referred_user_id: string | null;
  referral_code_id: string | null;
  userName?: string;
}

interface ReferralData {
  codes: ReferralCode[];
  referrals: Referral[];
  credits: ReferralCredit[];
  /** Datasets that hit the 1000-row page cap, so the totals below them are a
   *  floor rather than a figure. Empty in the normal case. */
  truncated: string[];
}

const AdminReferrals = () => {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"overview" | "codes" | "referrals" | "credits">("overview");

  // unwrap() throws into React Query so any failed fetch flips isError on
  // and surfaces a recoverable retry instead of degrading to four empty
  // tabs. CLAUDE.md: "Never drop the Supabase `error`".
  const { data, isInitialLoading, isError, refetch } = useInstantQuery<ReferralData>({
    key: ["admin-referrals"],
    fallback: { codes: [], referrals: [], credits: [], truncated: [] },
    fetcher: async () => {
      // PostgREST enforces db-max-rows = 1000 on this project (measured:
      // notifications, 1619 rows -> `content-range: 0-999/1619`). An unbounded
      // select silently truncates AFTER the ORDER BY, with no error and no
      // marker — and this screen reduces these three arrays into the operator's
      // referral TOTALS, including dollars issued and outstanding. Past 1000
      // rows those totals would quietly start under-reporting real money.
      //
      // So: ask for one row more than we display, and surface the truncation
      // instead of averaging it into a wrong number.
      const PAGE = 1000;
      const [codesRes, referralsRes, creditsRes] = await Promise.all([
        supabase.from("referral_codes").select("*").order("created_at", { ascending: false }).range(0, PAGE),
        supabase.from("referrals").select("*").order("created_at", { ascending: false }).range(0, PAGE),
        supabase.from("referral_credits").select("*").order("created_at", { ascending: false }).range(0, PAGE),
      ]);

      const allCodes = unwrap(codesRes) || [];
      const allReferrals = unwrap(referralsRes) || [];
      const allCredits = unwrap(creditsRes) || [];

      const truncated = [
        allCodes.length > PAGE ? "codes" : null,
        allReferrals.length > PAGE ? "referrals" : null,
        allCredits.length > PAGE ? "credits" : null,
      ].filter(Boolean) as string[];

      const userIds = new Set<string>();
      const addId = (id: string | null | undefined) => { if (id) userIds.add(id); };
      allCodes.forEach(c => addId(c.user_id));
      allReferrals.forEach(r => { addId(r.referrer_id); addId(r.referred_id); });
      allCredits.forEach(c => { addId(c.user_id); addId(c.referred_user_id); });

      const idsArray = Array.from(userIds);
      const nameMap: Record<string, string> = {};

      if (idsArray.length > 0) {
        const profiles = unwrap(
          await supabase
            .from("profiles")
            .select("user_id, full_name, email")
            .in("user_id", idsArray),
        );
        (profiles || []).forEach(p => {
          nameMap[p.user_id] = p.full_name || p.email || p.user_id.slice(0, 8);
        });
      }

      // A null owner is a DEPARTED account, not missing data — say so rather
      // than showing a blank cell an admin would read as a bug. A non-null id
      // with no profile row is a different thing (orphan), and still shows its
      // truncated id so it stays traceable.
      const DEPARTED = "Deleted account";
      const nameFor = (id: string | null | undefined) =>
        !id ? DEPARTED : nameMap[id] || id.slice(0, 8);

      return {
        truncated,
        codes: allCodes.slice(0, PAGE).map(c => ({ ...c, userName: nameFor(c.user_id) })),
        referrals: allReferrals.slice(0, PAGE).map(r => ({
          ...r,
          referrerName: nameFor(r.referrer_id),
          referredName: nameFor(r.referred_id),
        })),
        credits: allCredits.slice(0, PAGE).map(c => ({
          ...c,
          userName: nameFor(c.user_id),
        })),
      };
    },
  });

  const codes = data.codes;
  const referrals = data.referrals;
  const credits = data.credits;

  const totalEarned = credits.reduce((s, c) => s + Number(c.amount), 0);
  const totalCashedOut = credits.filter(c => c.redeemed).reduce((s, c) => s + Number(c.amount), 0);
  const totalAvailable = totalEarned - totalCashedOut;

  const filteredCodes = codes.filter(c =>
    !search || c.code.toLowerCase().includes(search.toLowerCase()) ||
    (c.userName || "").toLowerCase().includes(search.toLowerCase())
  );

  const filteredReferrals = referrals.filter(r =>
    !search || (r.referrerName || "").toLowerCase().includes(search.toLowerCase()) ||
    (r.referredName || "").toLowerCase().includes(search.toLowerCase())
  );

  const filteredCredits = credits.filter(c =>
    !search || (c.userName || "").toLowerCase().includes(search.toLowerCase()) ||
    c.reason.toLowerCase().includes(search.toLowerCase())
  );

  if (isInitialLoading) {
    return (
      // Shape-matched skeleton — stat grid + two row placeholders so the
      // loaded list slots in without a jarring jump from a bare text line.
      <div className="space-y-6" aria-hidden="true">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-4 space-y-2">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-7 w-2/3" />
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-16 w-full rounded-ds-md" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        variant="inline"
        title="We couldn't load referral data."
        body="Tap Try again. Codes, referrals, and credit ledgers are safe — this is just a fetch hiccup."
        onRetry={() => refetch()}
      />
    );
  }

  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "codes" as const, label: `Codes (${codes.length})` },
    { id: "referrals" as const, label: `Referrals (${referrals.length})` },
    { id: "credits" as const, label: `Credits (${credits.length})` },
  ];

  return (
    <AdminViewShell>
      {/* A silently-capped page would make every money figure below read as a
          measured total when it is really a floor. Say so rather than let an
          operator reconcile against a number that quietly stopped counting. */}
      {data.truncated.length > 0 && (
        <div
          className="rounded-2xl p-4 mb-4"
          style={{
            background: "hsl(var(--burnt-sienna) / 0.10)",
            border: "1px solid hsl(var(--burnt-sienna) / 0.42)",
          }}
        >
          <p className="text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
            <span className="font-semibold">Totals below are a floor, not a total.</span>{" "}
            {data.truncated.join(", ")} hit the 1,000-row page limit, so every figure on
            this screen counts only the most recent 1,000 rows. Export the full ledger
            before reconciling.
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Codes", value: codes.length, icon: Gift },
          { label: "Successful Referrals", value: referrals.length, icon: Users },
          { label: "Total Earned", value: `$${formatPriceExact(totalEarned)}`, icon: DollarSign },
          { label: "Cashed Out", value: `$${formatPriceExact(totalCashedOut)}`, icon: Banknote },
        ].map(stat => (
          <div key={stat.label} className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-ds-11 text-muted-foreground">{stat.label}</span>
              <stat.icon className="w-4 h-4 text-primary opacity-60" />
            </div>
            <p className="text-ds-24 font-bold text-foreground">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs. Four labels that each carry a count run past 375 — the strip
          scrolls with the shared edge fade instead of squeezing. */}
      <AdminFilterStrip label="Referral sections" className="gap-1 border-b border-border">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`shrink-0 px-4 py-2 text-ds-13 font-medium transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </AdminFilterStrip>

      {/* Search */}
      {tab !== "overview" && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search referrals by name or code"
            placeholder="Search by name or code…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      )}

      {/* Overview */}
      {tab === "overview" && (
        <div className="space-y-4">
          {/* `text-ds-13 font-semibold` sans headings were a fourth section-
              header treatment in the console. AdminCard carries the one. */}
          <AdminCard title="Program Summary">
            <div className="grid grid-cols-2 gap-4 text-ds-13">
              <div>
                <p className="text-muted-foreground">Users with codes</p>
                <p className="font-semibold text-foreground">{codes.length}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Successful referrals</p>
                <p className="font-semibold text-foreground">{referrals.length}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Credits awarded</p>
                <p className="font-semibold text-foreground">${totalEarned.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Credits available</p>
                <p className="font-semibold text-primary">${totalAvailable.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Credits cashed out</p>
                <p className="font-semibold text-foreground">${totalCashedOut.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Conversion rate</p>
                <p className="font-semibold text-foreground">
                  {codes.length > 0 ? ((referrals.length / codes.length) * 100).toFixed(1) : 0}%
                </p>
              </div>
            </div>
          </AdminCard>

          {/* Recent activity */}
          <AdminCard title="Recent Credits">
            {credits.slice(0, 5).map(c => (
              <div key={c.id} className="flex items-center justify-between text-ds-13 py-2 border-b border-border last:border-0">
                <div>
                  <p className="font-medium text-foreground">{c.userName}</p>
                  <p className="text-ds-11 text-muted-foreground">
                    {c.reason === "referrer_bonus" ? "Referral bonus" : "First job bonus"} · {formatShortDate(c.created_at)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-primary">+${Number(c.amount).toFixed(2)}</p>
                  <Badge variant={c.redeemed ? "secondary" : "default"} className="text-ds-10">
                    {c.redeemed ? "Cashed out" : "Available"}
                  </Badge>
                </div>
              </div>
            ))}
            {credits.length === 0 && (
              <EmptyState
                surfaceStyle={NESTED_EMPTY_SURFACE}
                variant="inline"
                icon={DollarSign}
                title="No credits awarded yet"
                body="Referral bonuses post here as soon as a referred user finishes their first job."
              />
            )}
          </AdminCard>
        </div>
      )}

      {/* Codes Tab */}
      {tab === "codes" && (
        <div className="space-y-2">
          {filteredCodes.map(c => (
            <div key={c.id} className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-ds-13 font-medium text-foreground">{c.userName}</p>
                <p className="text-ds-11 text-muted-foreground">Created {formatShortDate(c.created_at)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-ds-13 font-bold text-primary tracking-widest">{c.code}</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(c.code); }}
                  aria-label="Copy referral code"
                  className="p-1 rounded hover:bg-secondary/50 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
          ))}
          {filteredCodes.length === 0 && (
            <EmptyState
              variant="inline"
              icon={Gift}
              title={search ? "Nothing matches that search." : "No referral codes yet."}
              body={
                search
                  ? "Try a different name or code — the rest of the list is intact."
                  : "Each user gets a code on signup. They appear here as soon as anyone signs up."
              }
            />
          )}
        </div>
      )}

      {/* Referrals Tab */}
      {tab === "referrals" && (
        <div className="space-y-2">
          {filteredReferrals.map(r => (
            <div key={r.id} className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-ds-13 font-medium text-foreground">
                    <span className="text-primary">{r.referrerName}</span>
                    <span className="text-muted-foreground mx-2">→</span>
                    <span>{r.referredName}</span>
                  </p>
                  <p className="text-ds-11 text-muted-foreground mt-0.5">
                    Referred on {formatShortDate(r.created_at)}
                  </p>
                </div>
                {credits.some(c => c.referred_user_id === r.referred_id || c.referred_user_id === r.referrer_id) ? (
                  <Badge variant="default" className="text-ds-10">Bonus earned</Badge>
                ) : (
                  <Badge variant="sienna" className="text-ds-10">Awaiting first job</Badge>
                )}
              </div>
            </div>
          ))}
          {filteredReferrals.length === 0 && (
            <EmptyState
              variant="inline"
              icon={Users}
              title={search ? "Nothing matches that search." : "No referrals yet."}
              body={
                search
                  ? "Try a different name — the rest of the list is intact."
                  : "Referrals show up here the moment someone signs up with a referral code."
              }
            />
          )}
        </div>
      )}

      {/* Credits Tab */}
      {tab === "credits" && (
        <div className="space-y-2">
          {filteredCredits.map(c => (
            <div key={c.id} className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-ds-13 font-medium text-foreground">{c.userName}</p>
                <p className="text-ds-11 text-muted-foreground">
                  {c.reason === "referrer_bonus" ? "Referral bonus" : "First job bonus"} · {formatShortDate(c.created_at)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-ds-13 font-bold text-primary">+${Number(c.amount).toFixed(2)}</p>
                <Badge variant={c.redeemed ? "secondary" : "default"} className="text-ds-10">
                  {c.redeemed ? "Cashed out" : "Available"}
                </Badge>
              </div>
            </div>
          ))}
          {filteredCredits.length === 0 && (
            <EmptyState
              variant="inline"
              icon={Banknote}
              title={search ? "Nothing matches that search." : "No credits issued yet."}
              body={
                search
                  ? "Try a different name or reason — the rest of the ledger is intact."
                  : "Credits land here as referred users complete jobs."
              }
            />
          )}
        </div>
      )}
    </AdminViewShell>
  );
};

export default AdminReferrals;
