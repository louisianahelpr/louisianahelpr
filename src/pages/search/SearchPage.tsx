import { hideUnopenedInApp } from "@/lib/hideUnopenedInApp";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { hasInAppHistory } from "@/lib/inAppHistory";
import { useQuery } from "@tanstack/react-query";
import { Search, Store, X, type LucideIcon } from "lucide-react";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { useFeatureStatus } from "@/hooks/useFeature";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAuthReady } from "@/hooks/useAuthReady";
import { useSectionsOpen } from "@/components/landing/useSectionsOpen";
import { getBlockedUserIds } from "@/lib/userBlocks";
import { usePageTitle } from "@/hooks/usePageTitle";
import { jobDayLabel } from "@/lib/jobDateWindow";
import { readJobsAheadOfDb } from "@/lib/jobColumns";
import { SEARCH_PARAM } from "@/components/landing/heroSearch";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { firstPhotos } from "@/components/declutter/DeclutterItemCard";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { fetchPhotos, photoPublicUrl } from "@/lib/declutter/api";
import { squarePhotoUrl, THUMB_PHOTO_PX } from "@/lib/declutter/photoSizes";
import { FallbackImg } from "@/components/declutter/FallbackImg";
import { matchesSearch, searchOrFilter } from "@/lib/declutter/searchMatch";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { SaveSearchButton } from "@/components/savedSearches/SaveSearchButton";
import { likePattern, type SearchSection } from "./searchQuery";
import { SearchStart } from "./SearchStart";
import { pushRecentSearch } from "@/lib/searchHistory";
import { searchJobPrice, type PricedJobHit } from "./searchJobPrice";
import { useFirstPayoutFeeDollars } from "@/hooks/useFirstPayoutFee";
import { tierFeePercent } from "@/lib/subscriptionTiers";

/**
 * /search?q= — one search across the sections (board 89).
 *
 * Every row is a real row: Jobs from `open_jobs_browse` (the browse view, so
 * the same visibility rules as Jobs Browse), Declutter from `declutter_items`
 * (live or reserved, RLS and the 'declutter' switch decide, as on Declutter
 * Browse). Counts are the database's exact counts, shown only when > 0.
 * Shops (Q2725) from `shops` once its switch is on for a SIGNED-IN member
 * (RLS shop_publicly_visible: not hidden, owner not banned, no test shop while
 * seeds are hidden; anon has no read, so a guest is not searched there).
 * Shops and Homes read "Coming soon" while their switch is off for this
 * member; nothing there is searched until it opens.
 *
 * NO ADDRESS (spec v2 §1.6): a job shows its parish, an item its area label.
 */
const PER_SECTION = 3;
/** A chip (or "See all") shows up to this many; beyond it, Jobs opens Browse. */
const MAX_ROWS = 20;

type JobHit = PricedJobHit & { id: string; title: string; category: string | null; parish: string | null; date_needed: string | null; date_window_end?: string | null };
type ItemHit = { id: string; title: string; description: string | null; category: string | null; current_price_cents: number | null; price_cents: number | null; area_label: string | null };

function useJobHits(q: string, userId: string | null) {
  return useQuery({
    queryKey: ["search", "jobs", q, userId],
    // F071 (owner 11-09): a guest may search too. open_jobs_browse is readable signed out; a guest has no blocks.
    enabled: q.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      // Jobs Browse hides posters on either side of a block (Q573); so does
      // search, in the query itself so the exact count stays exact.
      // getBlockedUserIds throws on a failed read: the error state, never
      // jobs from someone blocked.
      const blocked = userId ? [...(await getBlockedUserIds(userId))] : [];
      // Q2408: + date_window_end, so a window job reads "Any day Nov 4-10" (jobDayLabel); through readJobsAheadOfDb,
      // which asks once more without it on a database that does not have it yet.
      const res = await readJobsAheadOfDb(
        "id,title,category,budget,pricing_mode,parish,date_needed,date_window_end,urgent_fee,is_group_job,helpers_needed,customer_id,helper_fee_flat_cents,helper_fee_percent",
        (columns) => {
          let query = supabase.from("open_jobs_browse").select(columns, { count: "exact" }).ilike("title", likePattern(q));
          if (blocked.length) query = query.not("customer_id", "in", `(${blocked.join(",")})`);
          return query.order("created_at", { ascending: false }).limit(MAX_ROWS);
        },
        { browseView: true },
      );
      return { rows: (unwrap(res) ?? []) as unknown as JobHit[], count: res.count ?? 0 };
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
      // F222 (audit 11-10): "chair" led with a blanket whose long description said chair, so results read as random.
      // Items whose TITLE has every word come first; newest first within each (the sort is stable).
      const titleHit = (it: ItemHit) => (matchesSearch(q, { title: it.title }) ? 0 : 1);
      const rows = all.filter((it) => matchesSearch(q, it)).sort((a, b) => titleHit(a) - titleHit(b));
      const total = res.count ?? 0;
      return { rows, count: total <= all.length ? rows.length : total };
    },
  });
}

type ShopHit = { id: string; name: string; about: string | null; category: string | null; area_label: string | null };

/**
 * Q2725: shops whose name, about or category has every word (the Declutter rule, searchMatch.ts), name hits first.
 * Signed-in members only: shops is readable by `authenticated` under shop_publicly_visible, never by anon.
 */
function useShopHits(q: string, on: boolean) {
  return useQuery({
    queryKey: ["search", "shops", q],
    enabled: on && q.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await supabase
        .from("shops")
        .select("id,name,about,category,area_label", { count: "exact" })
        .or(searchOrFilter(q, ["name", "about", "category"]) ?? "name.ilike.*")
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS);
      const all = (unwrap(res) ?? []) as ShopHit[];
      const asItem = (s: ShopHit) => ({ title: s.name, description: s.about, category: s.category });
      const nameHit = (s: ShopHit) => (matchesSearch(q, { title: s.name }) ? 0 : 1);
      const rows = all.filter((s) => matchesSearch(q, asItem(s))).sort((a, b) => nameHit(a) - nameHit(b));
      const total = res.count ?? 0;
      return { rows, count: total <= all.length ? rows.length : total };
    },
  });
}

/* Shared by Row and RowSkeleton so the placeholder cannot drift from the row it stands in for (Q2018). */
const ROW_CLASS = "flex items-center gap-3 px-4 py-3 min-h-[56px] border-b border-border last:border-b-0";
const THUMB_CLASS = "shrink-0 w-11 h-11 rounded-xl";
/* 28px with or without "See all" (Q2018, as Q833 did for ActivityBucketGroups): the button's 44px floor
   (index.css) made the row 44px only when a group held more than PER_SECTION rows, so no placeholder could
   match both. `-my-2` keeps its 44px target reaching 8px past the row: the group's space-y-2 below, half the
   page's space-y-4 above, so it covers no row. */
const GROUP_HEAD_CLASS = "flex min-h-7 items-center justify-between px-1";
const GROUP_CARD_CLASS = "rounded-2xl overflow-hidden";

/** The 44px square that leads every row: an item's cover photo, a job's category icon. The photo is the 160 px square
 * (Q2707 raw tiles: a live seller photo 407,886-573,453 B raw, 5,126-7,184 B as the square, 2026-11-05), the original
 * only if that fails, then the placeholder. */
function Thumb({ photo, icon, seed }: { photo?: string | null; icon: LucideIcon; seed: string | null }) {
  return (
    <span className={`${THUMB_CLASS} overflow-hidden bg-photo-empty`} aria-hidden>
      {photo ? <FallbackImg loading="lazy" decoding="async" src={squarePhotoUrl(photoPublicUrl(photo), THUMB_PHOTO_PX) ?? photoPublicUrl(photo)} retrySrc={photoPublicUrl(photo)} width={THUMB_PHOTO_PX} height={THUMB_PHOTO_PX} alt="" className="w-full h-full object-cover" fallback={<PhotoPlaceholder icon={icon} seed={seed} className="w-full h-full" />} /> : <PhotoPlaceholder icon={icon} seed={seed} className="w-full h-full" />}
    </span>
  );
}

function Row({ to, title, sub, price, thumb }: { to: string; title: string; sub?: string | null; price?: string | null; thumb?: React.ReactNode }) {
  return (
    <Link
      to={to}
      // The title and line clip at 375; the full text stays reachable.
      title={sub ? `${title} · ${sub}` : title}
      className={`${ROW_CLASS} ctl-tint`}
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
      <div className={GROUP_HEAD_CLASS}>
        <h2 className="font-sans font-bold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>{title}</h2>
        {onSeeAll && count > PER_SECTION && (
          <InlineTextButton onClick={onSeeAll} className="font-sans font-semibold text-ds-13" style={{ color: "hsl(var(--bark))" }}>
            {/* Q2644: "See 20 of 59" read like a count of what is shown, not an action. */}
            {count > MAX_ROWS ? "See more" : `See all ${count}`}
          </InlineTextButton>
        )}
      </div>
      <div className={GROUP_CARD_CLASS} style={{ background: "hsl(var(--card))" }}>{children}</div>
    </section>
  );
}

/**
 * Q2018: while the first answer is on its way the page showed nothing under
 * the search box. This is one result group (head line + PER_SECTION rows;
 * ChipsSkeleton holds the chip row) in the SAME classes as Group and Row, so the rows that
 * land replace it in place (measured: 0px row and group shift at 375 and 1440).
 */
function GroupSkeleton() {
  return (
    <div className="space-y-2" aria-hidden data-testid="search-loading">
      <div className={`${GROUP_HEAD_CLASS} font-sans font-bold text-ds-15`}>
        <Skeleton className="h-3.5 w-24" />
      </div>
      <div className={GROUP_CARD_CLASS} style={{ background: "hsl(var(--card))" }}>
        {Array.from({ length: PER_SECTION }, (_, i) => (
          <div key={i} className={ROW_CLASS} data-testid="search-loading-row">
            <Skeleton className={THUMB_CLASS} />
            <span className="flex-1 min-w-0 space-y-2">
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </span>
            <Skeleton className="shrink-0 h-3.5 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The section chips (All / Jobs · n / Declutter · n), in their own slot above "Save this search". */
function ChipsSkeleton() {
  return (
    <div className="flex flex-wrap gap-2" aria-hidden data-testid="search-loading-chips">
      <Skeleton className="h-10 w-14 rounded-full" />
      <Skeleton className="h-10 w-28 rounded-full" />
    </div>
  );
}

/** "Shops and Homes are coming soon." from the closed sections, in order; "" when none is closed. */
function soonSentence(names: string[]): string {
  if (names.length === 0) return "";
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} ${names.length === 1 ? "is" : "are"} coming soon.`;
}

/**
 * F224 (whole-app audit 2026-11-10): each closed section was a full card-sized "Coming soon" row, as big as a real
 * result. They are now one small line under the results.
 */
function SoonLine({ names }: { names: string[] }) {
  // The iPhone app shows no closed section (owner 10-31, src/lib/hideUnopenedInApp.ts); the website keeps the line.
  if (hideUnopenedInApp() || names.length === 0) return null;
  return <p data-search-soon="" className="font-sans text-ds-13 text-muted-foreground px-1">{soonSentence(names)}</p>;
}

export default function SearchPage() {
  usePageTitle("Search — Helpr");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = (params.get(SEARCH_PARAM) ?? "").trim();
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  const [section, setSection] = useState<SearchSection>("all");

  const { user, profile } = useCurrentUser();
  // Job hits are priced like the Jobs browse card (Q2642): the viewer's tier
  // rate (as useDashboardData) and the one-time setup fee still owed.
  const viewerFee = tierFeePercent(profile?.subscription_tier, profile?.subscription_expires_at ?? null);
  const firstPayoutFee = useFirstPayoutFeeDollars();
  // A switch reads false until its answer arrives; "Coming soon" waits for
  // the settled answer so a slow read never says a section is closed.
  // L001 (landing audit 11-09, High): useFeatureStatus is false for every switch when signed out, so a guest read
  // "Declutter Coming soon" and got no Declutter results while /declutter is open to everyone. A guest's sections are
  // the switches open to EVERYONE (features_open_to_everyone, the answer the Declutter guest gate and the landing read);
  // a member's are their own switches, as before.
  const { isReady: authReady } = useAuthReady();
  const guest = authReady && !user;
  const openToAll = useSectionsOpen(guest);
  const forViewer = (key: string, member: { on: boolean; settled: boolean }) =>
    guest ? { on: !!openToAll.open?.has(key), settled: openToAll.settled } : member;
  const declutter = forViewer("declutter", useFeatureStatus("declutter"));
  const shops = forViewer("shops", useFeatureStatus("shops"));
  const homes = forViewer("rentals", useFeatureStatus("rentals"));
  const declutterOn = declutter.on;
  const switchesSettled = declutter.settled && shops.settled && homes.settled;
  const jobs = useJobHits(q, user?.id ?? null);
  const items = useItemHits(q, declutterOn);
  // Q2725: a guest's Shops switch can be open to everyone, but anon cannot read shops, so only members search it.
  const shopsOn = shops.on && !!user;
  const shopHits = useShopHits(q, shopsOn);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = draft.trim();
    // F142: a search the member ran is offered again on the empty /search (SearchStart's Recent searches).
    if (next) pushRecentSearch(next);
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
  const shopCount = shopsOn ? shopHits.data?.count ?? 0 : 0;
  // isPending, not isLoading: a read paused offline stays loading, never the empty state (Q571).
  const loading = !switchesSettled || jobs.isPending || (declutterOn && items.isPending) || (shopsOn && shopHits.isPending);
  const failed = jobs.isError || (declutterOn && items.isError) || (shopsOn && shopHits.isError);
  const qs = `${SEARCH_PARAM}=${encodeURIComponent(q)}`;
  const chips: { key: SearchSection; label: string; count?: number }[] = [
    { key: "all", label: "All" },
    ...(jobCount > 0 ? [{ key: "jobs" as const, label: "Jobs", count: jobCount }] : []),
    ...(itemCount > 0 ? [{ key: "declutter" as const, label: "Declutter", count: itemCount }] : []),
    ...(shopCount > 0 ? [{ key: "shops" as const, label: "Shops", count: shopCount }] : []),
  ];
  const show = (s: SearchSection) => section === "all" || section === s;
  // AUD31-39: the box named Shops and Homes, both Coming soon, and was cut at 375; it names what it searches.
  const fieldLabel = declutterOn ? (shopsOn ? "Search jobs, items and shops" : "Search jobs and items") : shopsOn ? "Search jobs and shops" : "Search jobs";

  return (
    // L005 (landing audit 11-09): a cold-opened link had no in-app entry behind it, so back went to about:blank.
    <AppPage title="Search" onBack={() => (hasInAppHistory() ? navigate(-1) : navigate("/", { replace: true }))}>
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
            <Button type="button" variant="ghost" size="iconCompact" onClick={() => setDraft("")} aria-label="Clear search" className="shrink-0 text-muted-foreground ctl-exit [&_svg]:size-4">
              <X />
            </Button>
          )}
        </form>

        {q && loading && !failed && <ChipsSkeleton />}
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

        {!q && <SearchStart userId={user?.id ?? null} declutterOn={declutterOn} signedIn={!!user} />}
        {q && failed && (
          <div className="flex items-center justify-between gap-3 px-1" role="alert">
            <p className="font-sans text-ds-13" style={{ color: "hsl(var(--alert-ink))" }}>Search didn't load.</p>
            <button type="button" onClick={() => { void jobs.refetch(); if (declutterOn) void items.refetch(); if (shopsOn) void shopHits.refetch(); }} className="font-sans font-semibold text-ds-13 min-h-[44px] px-2" style={{ color: "hsl(var(--bark))" }}>
              Try again
            </button>
          </div>
        )}
        {q && loading && !failed && (
          <>
            <p role="status" className="sr-only">Searching…</p>
            <GroupSkeleton />
          </>
        )}
        {q && !loading && !failed && jobCount === 0 && itemCount === 0 && shopCount === 0 && (
          // A real empty state (audit #27): what happened, and the way on.
          <EmptyState
            icon={Search}
            title={`Nothing matches “${q}” yet`}
            // F221 (audit 11-10): a guest has no Save button (SaveSearchButton needs an account), so the guest copy
            // makes no promise there is nothing to tap for.
            body={user
              ? "Save this search and we'll tell you when something new matches, or look through everything open now."
              : "Try fewer words, or look through everything open now."}
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
                <Row key={it.id} to={`/declutter/item/${it.id}`} title={it.title} sub={it.area_label} thumb={<Thumb photo={cover.get(it.id) ?? null} icon={categoryIcon(it.category)} seed={it.category} />} price={typeof cents === "number" ? itemPriceLabel(cents) : null} />
              );
            })}
          </Group>
        )}

        {q && shopsOn && shopCount > 0 && show("shops") && (
          <Group title="Shops" count={shopCount} onSeeAll={section === "all" ? () => setSection("shops") : undefined}>
            {shopHits.data!.rows.slice(0, section === "all" ? PER_SECTION : MAX_ROWS).map((s) => (
              <Row key={s.id} to={`/shops/${s.id}`} title={s.name} sub={s.area_label} thumb={<Thumb icon={Store} seed={s.category} />} />
            ))}
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
                sub={[j.parish ? `${j.parish} Parish` : null, j.date_needed ? jobDayLabel(j) : null].filter(Boolean).join(" · ") || null}
                price={searchJobPrice(j, user?.id ?? null, viewerFee, firstPayoutFee)}
              />
            ))}
          </Group>
        )}
        {q && section === "jobs" && jobCount > MAX_ROWS && (
          <Link to={user ? `/jobs?tab=browse&${qs}` : `/browse?${qs}`} className="block text-center font-sans font-semibold text-ds-13 min-h-[44px] leading-[44px]" style={{ color: "hsl(var(--bark))" }}>
            See all {jobCount} in Jobs
          </Link>
        )}

        {q && section === "all" && switchesSettled && (
          <SoonLine names={[...(declutter.on ? [] : ["Declutter"]), ...(shops.on ? [] : ["Shops"]), ...(homes.on ? [] : ["Homes"])]} />
        )}
      </div>
    </AppPage>
  );
}
