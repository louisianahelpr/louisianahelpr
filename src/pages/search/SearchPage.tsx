import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, X, type LucideIcon } from "lucide-react";
import AppPage from "@/components/AppPage";
import { EmptyState } from "@/components/ui/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useFeatureStatus } from "@/hooks/useFeature";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { getBlockedUserIds } from "@/lib/userBlocks";
import { usePageTitle } from "@/hooks/usePageTitle";
import { formatPrice } from "@/lib/format";
import { formatJobDate } from "@/lib/dateUtils";
import { SEARCH_PARAM } from "@/components/landing/heroSearch";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { firstPhotos } from "@/components/declutter/DeclutterItemCard";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { fetchPhotos, photoPublicUrl } from "@/lib/declutter/api";
import { matchesSearch, searchOrFilter } from "@/lib/declutter/searchMatch";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { SaveSearchButton } from "@/components/savedSearches/SaveSearchButton";
import { likePattern, type SearchSection } from "./searchQuery";

/**
 * /search?q= — one search across the sections (board 89).
 *
 * Every row is a real row: Jobs from `open_jobs_browse` (the browse view, so
 * the same visibility rules as Jobs Browse), Declutter from `declutter_items`
 * (live or reserved, RLS and the 'declutter' switch decide, as on Declutter
 * Browse). Counts are the database's exact counts, shown only when > 0.
 * Shops and Homes read "Coming soon" while their switch is off for this
 * member; nothing there is searched until it opens.
 *
 * NO ADDRESS (spec v2 §1.6): a job shows its parish, an item its area label.
 */
const PER_SECTION = 3;
/** A chip (or "See all") shows up to this many; beyond it, Jobs opens Browse. */
const MAX_ROWS = 20;

type JobHit = { id: string; title: string; category: string | null; budget: number | null; pricing_mode: string | null; parish: string | null; date_needed: string | null };
type ItemHit = { id: string; title: string; description: string | null; category: string | null; current_price_cents: number | null; price_cents: number | null; area_label: string | null };

function useJobHits(q: string, userId: string | null) {
  return useQuery({
    queryKey: ["search", "jobs", q, userId],
    enabled: q.length > 0 && !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      // Jobs Browse hides posters on either side of a block (Q573); so does
      // search, in the query itself so the exact count stays exact.
      // getBlockedUserIds throws on a failed read: the error state, never
      // jobs from someone blocked.
      const blocked = [...(await getBlockedUserIds(userId!))];
      let query = supabase
        .from("open_jobs_browse")
        .select("id,title,category,budget,pricing_mode,parish,date_needed", { count: "exact" })
        .ilike("title", likePattern(q));
      if (blocked.length) query = query.not("customer_id", "in", `(${blocked.join(",")})`);
      const res = await query
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS);
      return { rows: (unwrap(res) ?? []) as JobHit[], count: res.count ?? 0 };
    },
  });
}

function useItemHits(q: string, on: boolean) {
  return useQuery({
    queryKey: ["search", "declutter", q],
    enabled: on && q.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      // Every word, in the title, description or category, plurals folded: the one Declutter rule (DA-1,
      // searchMatch.ts). The database filter is a little wider than the rule, so the rows are re-checked here;
      // when every candidate came back the count is the re-checked count, else the database's.
      const res = await supabase
        .from("declutter_items")
        .select("id,title,description,category,current_price_cents,price_cents,area_label", { count: "exact" })
        .in("status", ["live", "reserved"])
        .or(searchOrFilter(q) ?? "title.ilike.*")
        .order("live_at", { ascending: false })
        .limit(MAX_ROWS);
      const all = (unwrap(res) ?? []) as ItemHit[];
      const rows = all.filter((it) => matchesSearch(q, it));
      const total = res.count ?? 0;
      return { rows, count: total <= all.length ? rows.length : total };
    },
  });
}

/** The 44px square that leads every row: an item's cover photo, a job's category icon. */
function Thumb({ photo, icon, seed }: { photo?: string | null; icon: LucideIcon; seed: string | null }) {
  return (
    <span className="shrink-0 w-11 h-11 rounded-xl overflow-hidden bg-photo-empty" aria-hidden>
      {photo ? <img src={photoPublicUrl(photo)} alt="" loading="lazy" className="w-full h-full object-cover" /> : <PhotoPlaceholder icon={icon} seed={seed} className="w-full h-full" />}
    </span>
  );
}

function Row({ to, title, sub, price, thumb }: { to: string; title: string; sub?: string | null; price?: string | null; thumb?: React.ReactNode }) {
  return (
    <Link
      to={to}
      // The title and line clip at 375; the full text stays reachable.
      title={sub ? `${title} · ${sub}` : title}
      className="flex items-center gap-3 px-4 py-3 min-h-[56px] border-b border-border last:border-b-0 ctl-tint"
    >
      {thumb}
      <span className="flex-1 min-w-0">
        <span className="block font-sans font-semibold text-ds-14 leading-snug truncate" style={{ color: "hsl(var(--ink-deep))" }}>{title}</span>
        {sub && <span className="block font-sans text-ds-12 text-muted-foreground truncate">{sub}</span>}
      </span>
      {price && <span className="shrink-0 font-sans font-bold text-ds-14 tabular-nums" style={{ color: "hsl(var(--burnt-sienna))" }}>{price}</span>}
    </Link>
  );
}

function Group({ title, count, onSeeAll, children }: { title: string; count: number; onSeeAll?: () => void; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="font-sans font-bold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>{title}</h2>
        {onSeeAll && count > PER_SECTION && (
          <button type="button" onClick={onSeeAll} className="font-sans font-semibold text-ds-13 min-h-[44px]" style={{ color: "hsl(var(--bark))" }}>
            {count > MAX_ROWS ? `See ${MAX_ROWS} of ${count}` : `See all ${count}`}
          </button>
        )}
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(var(--card))" }}>{children}</div>
    </section>
  );
}

function SoonRow({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl px-4 min-h-[52px]" style={{ background: "hsl(var(--card))" }}>
      <span className="font-sans font-semibold text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>{name}</span>
      <span className="font-sans font-semibold text-ds-11 rounded-full px-2.5 py-1" style={{ background: "hsl(var(--sand))", color: "hsl(var(--olivewood))" }}>
        Coming soon
      </span>
    </div>
  );
}

export default function SearchPage() {
  usePageTitle("Search — Helpr");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = (params.get(SEARCH_PARAM) ?? "").trim();
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  const [section, setSection] = useState<SearchSection>("all");

  const { user } = useCurrentUser();
  // A switch reads false until its answer arrives; "Coming soon" waits for
  // the settled answer so a slow read never says a section is closed.
  const declutter = useFeatureStatus("declutter");
  const shops = useFeatureStatus("shops");
  const homes = useFeatureStatus("rentals");
  const declutterOn = declutter.on;
  const switchesSettled = declutter.settled && shops.settled && homes.settled;
  const jobs = useJobHits(q, user?.id ?? null);
  const items = useItemHits(q, declutterOn);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = draft.trim();
    setParams(next ? { [SEARCH_PARAM]: next } : {}, { replace: true });
  };

  // Declutter is photo-first: each row leads with its cover photo, read the
  // way Browse reads it (its own query, so a failed photo read leaves the
  // placeholder and never hides the results).
  const itemIds = (items.data?.rows ?? []).map((r) => r.id);
  const photos = useQuery({
    queryKey: ["search", "declutter-photos", itemIds],
    enabled: itemIds.length > 0,
    staleTime: 60_000,
    queryFn: () => fetchPhotos(itemIds),
  });
  const cover = firstPhotos(photos.data ?? []);
  const jobCount = jobs.data?.count ?? 0;
  const itemCount = declutterOn ? items.data?.count ?? 0 : 0;
  // isPending, not isLoading: a read paused offline stays loading, never the empty state (Q571).
  const loading = !switchesSettled || jobs.isPending || (declutterOn && items.isPending);
  const failed = jobs.isError || (declutterOn && items.isError);
  const qs = `${SEARCH_PARAM}=${encodeURIComponent(q)}`;
  const chips: { key: SearchSection; label: string; count?: number }[] = [
    { key: "all", label: "All" },
    ...(jobCount > 0 ? [{ key: "jobs" as const, label: "Jobs", count: jobCount }] : []),
    ...(itemCount > 0 ? [{ key: "declutter" as const, label: "Declutter", count: itemCount }] : []),
  ];
  const show = (s: SearchSection) => section === "all" || section === s;
  // AUD31-39: the box named Shops and Homes, both Coming soon, and was cut at 375; it names what it searches.
  const fieldLabel = declutterOn ? "Search jobs and items" : "Search jobs";

  return (
    <AppPage title="Search" onBack={() => navigate(-1)}>
      <div className="space-y-4 pb-6" data-testid="search-page">
        <form role="search" aria-label="Search Helpr" onSubmit={submit} className="flex items-center gap-2 h-12 pl-4 pr-1 rounded-full border border-border focus-within:ring-2 focus-within:ring-ring" style={{ background: "hsl(var(--card))" }}>
          <Search className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="search"
            enterKeyHint="search"
            autoFocus={!q}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={fieldLabel}
            aria-label={fieldLabel}
            // The pill draws the focus ring (focus-within); the input must not draw a second, square one (audit #27).
            className="flex-1 min-w-0 bg-transparent outline-none focus-visible:outline-none font-sans text-ds-15"
          />
          {draft && (
            <button type="button" onClick={() => setDraft("")} aria-label="Clear search" className="shrink-0 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-muted-foreground ctl-exit">
              <X className="w-4 h-4" />
            </button>
          )}
        </form>

        {q && chips.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Show results from">
            {chips.map((c) => {
              const on = section === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSection(c.key)}
                  className={`rounded-full px-4 min-h-[40px] font-sans font-semibold text-ds-13 ${on ? "btn-grad-primary" : "border border-border"}`}
                  style={on ? undefined : { background: "hsl(var(--card))", color: "hsl(var(--ink-deep))" }}
                >
                  {c.label}{c.count ? ` · ${c.count}` : ""}
                </button>
              );
            })}
          </div>
        )}

        {q && switchesSettled && (
          // Board 91: save the words as an alert. With "All" the sheet asks
          // which open section to watch.
          <SaveSearchButton
            userId={user?.id}
            draft={{ section: declutterOn && (section === "declutter" || (section === "all" && itemCount > 0 && jobCount === 0)) ? "declutter" : "jobs", query: q, category: null, minDollars: null, maxDollars: null, radiusMiles: null }}
            sections={section === "all" && declutterOn ? ["jobs", "declutter"] : undefined}
          />
        )}

        {!q && <p className="font-sans text-ds-13 text-muted-foreground px-1">Search every section at once.</p>}
        {q && failed && (
          <div className="flex items-center justify-between gap-3 px-1" role="alert">
            <p className="font-sans text-ds-13" style={{ color: "hsl(var(--alert-ink))" }}>Search didn't load.</p>
            <button type="button" onClick={() => { void jobs.refetch(); if (declutterOn) void items.refetch(); }} className="font-sans font-semibold text-ds-13 min-h-[44px] px-2" style={{ color: "hsl(var(--bark))" }}>
              Try again
            </button>
          </div>
        )}
        {q && !loading && !failed && jobCount === 0 && itemCount === 0 && (
          // A real empty state (audit #27): what happened, and the way on.
          <EmptyState
            icon={Search}
            title={`Nothing matches “${q}” yet`}
            body="Save this search and we'll tell you when something new matches, or look through everything open now."
            // AUD31-32: it searched Declutter too, so it offers Declutter's Browse as well.
            action={
              <span className="inline-flex flex-wrap justify-center gap-x-4 gap-y-2">
                <Link to="/jobs" className="font-sans font-semibold text-ds-14 underline underline-offset-2" style={{ color: "hsl(var(--bark))" }}>Browse all jobs</Link>
                {declutterOn && (
                  <Link to="/declutter" className="font-sans font-semibold text-ds-14 underline underline-offset-2" style={{ color: "hsl(var(--bark))" }}>Browse Declutter</Link>
                )}
              </span>
            }
          />
        )}

        {q && declutterOn && itemCount > 0 && show("declutter") && (
          <Group title="Declutter" count={itemCount} onSeeAll={section === "all" ? () => setSection("declutter") : undefined}>
            {items.data!.rows.slice(0, section === "all" ? PER_SECTION : MAX_ROWS).map((it) => {
              const cents = it.current_price_cents ?? it.price_cents;
              return (
                <Row key={it.id} to={`/declutter/item/${it.id}`} title={it.title} sub={it.area_label} thumb={<Thumb photo={cover.get(it.id) ?? null} icon={categoryIcon(it.category)} seed={it.category} />} price={typeof cents === "number" ? `$${formatPrice(cents / 100)}` : null} />
              );
            })}
          </Group>
        )}

        {q && jobCount > 0 && show("jobs") && (
          <Group title="Jobs" count={jobCount} onSeeAll={section === "all" ? () => setSection("jobs") : undefined}>
            {jobs.data!.rows.slice(0, section === "all" ? PER_SECTION : MAX_ROWS).map((j) => (
              <Row
                key={j.id}
                to={`/jobs/${j.id}`}
                title={j.title}
                thumb={<Thumb icon={getCategoryIcon(j.category)} seed={j.category} />}
                sub={[j.parish ? `${j.parish} Parish` : null, j.date_needed ? formatJobDate(j.date_needed) : null].filter(Boolean).join(" · ") || null}
                price={j.pricing_mode === "quote" ? "Quote" : typeof j.budget === "number" && j.budget > 0 ? `$${formatPrice(j.budget)}` : null}
              />
            ))}
          </Group>
        )}
        {q && section === "jobs" && jobCount > MAX_ROWS && (
          <Link to={`/jobs?tab=browse&${qs}`} className="block text-center font-sans font-semibold text-ds-13 min-h-[44px] leading-[44px]" style={{ color: "hsl(var(--bark))" }}>
            See all {jobCount} in Jobs
          </Link>
        )}

        {q && section === "all" && switchesSettled && (
          <div className="space-y-2">
            {!declutter.on && <SoonRow name="Declutter" />}
            {!shops.on && <SoonRow name="Shops" />}
            {!homes.on && <SoonRow name="Homes" />}
          </div>
        )}
      </div>
    </AppPage>
  );
}
