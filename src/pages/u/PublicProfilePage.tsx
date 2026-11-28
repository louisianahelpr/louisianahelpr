/**
 * /u/:handle: a member's shareable profile (LEAD-PROFILE-LINK, owner 2026-10-31 ~10:50 PM, OWNER-DECISIONS
 * "Shareable profile link"). Open to anyone with the link, signed out included: the member's public name, photo,
 * member since and public stats, their live Declutter listings, their open jobs (town only), their Helpr work
 * (jobs done, categories, reviews) and their public Wanted posts. Everything comes from ONE read,
 * public_profile_by_handle (20261101041833), which never returns contacts, addresses, coordinates or test data.
 * It has no user id field, but the photo and Recent work URLs are public avatars-bucket paths whose folder IS the
 * user id (avatars/<user id>/...; L5, audit 11-05). That id is already public through /book and /user links, so this
 * is not a leak (20261105172728 says so in the function's comment). Listing photos go by photo id through shop-photo.
 * An old (retired) handle opens the member's current page and the address bar moves to the current handle (L2).
 *
 * "Hire me" (owner 2026-11-04) opens Post a job with a direct offer to this member, free for everyone; never on your
 * own page (src/lib/hireMe.ts, rpc_hire_target_by_handle).
 *
 * Buying, applying and replying ask a guest to sign up and bring them back (signupUrlFor). The link card (og:*)
 * comes from api/share.ts before JS runs.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BadgeCheck, Briefcase, Handshake, ImageIcon, MapPin, MessageSquare, Share2, ShoppingBag, Star, UserX, Search } from "lucide-react";
import { HelperWorkPhotos } from "@/components/profile/HelperWorkPhotos";
import AppPage from "@/components/AppPage";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { PUBLIC_LINK_COLUMN } from "@/lib/pageColumn";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import UserAvatar from "@/components/UserAvatar";
import { ID_VERIFIED_LABEL, ID_VERIFIED_PILL_STYLE, IdVerifiedShield } from "@/components/profile/IdVerifiedPill";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useAuthReady } from "@/hooks/useAuthReady";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import "@/lib/i18n/enYourPage";
import { t } from "@/lib/i18n/language";
import { signupUrlFor } from "@/lib/jobIntent";
import { jobCategoryLabel } from "@/lib/jobCategories";
import { itemPriceLabel } from "@/lib/declutter/distance";
import { buyerPriceLabel } from "@/components/declutter/BuyerPrice";
import {
  fetchPublicProfile,
  handleFromPath,
  listingPhotoUrl,
  profileLinkUrl,
  shareMyProfile,
  type PublicProfile,
} from "@/lib/profileLink/api";
import { HIRE_PARAM, hireGuestHref, hireGuestLoginHref, hireOfferPath, hireTargetByHandle } from "@/lib/hireMe";
import { isHelprTeam } from "@/lib/helprTeam";
import { quickListHref } from "@/lib/declutter/wantedLinks";
import { PublicProfileReviews, reviewTotal } from "@/components/profile/publicProfile/PublicProfileReviews";
import { PublicProfileOwnerSteps } from "@/components/profile/publicProfile/PublicProfileOwnerSteps";
import { PublicProfileSkeleton } from "@/components/profile/publicProfile/PublicProfileSkeleton";
import { PublicProfileMemberActions } from "@/components/profile/publicProfile/PublicProfileMemberActions";
import { PublicProfileMovingSale } from "@/components/profile/publicProfile/PublicProfileMovingSale";
import { MyJobPhotosPicker, PublicJobPhotos } from "@/components/profile/publicProfile/PublicJobPhotos";
import { PublicProfileBio } from "@/components/profile/publicProfile/PublicProfileBio";
import { PublicProfileTabs, activeTab, paneHiddenClass, profileTabs, type ProfileTabKey } from "@/components/profile/publicProfile/PublicProfileTabs";

const ROBOTS = "noindex, follow";
/** L7 (owner 11-05): search engines index a page only when its member turned "Show my profile in search engines" on. */
const ROBOTS_SHOWN = "index, follow";

/** "March 2025". */
function memberSinceLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/Chicago" });
}

/** "4.8 (12 reviews) · 8 jobs done", or "" when there is nothing to say yet. */
function profileTrustLine(p: Pick<PublicProfile, "stats" | "helpr">): string {
  const parts: string[] = [];
  const n = p.stats.review_count ?? 0;
  if (n > 0 && p.stats.avg_rating != null) parts.push(`${Number(p.stats.avg_rating).toFixed(1)} (${n} review${n === 1 ? "" : "s"})`);
  const done = p.helpr.jobs_done ?? 0;
  if (done > 0) parts.push(`${done} job${done === 1 ? "" : "s"} done`);
  return parts.join(" · ");
}

/** Where a CTA goes: the page itself for a member, signup and back for a guest. */
function guestAware(path: string, signedIn: boolean): string {
  return signedIn ? path : signupUrlFor(path);
}

function Meta({ p, handle }: { p: PublicProfile | null | undefined; handle: string | null }) {
  usePageMeta({
    title: p ? `${p.name} on Louisiana Helpr` : "Profile — Louisiana Helpr",
    description: p ? `See what ${p.name} posts and does on Louisiana Helpr.` : "A member's profile on Louisiana Helpr.",
    canonical: handle ? profileLinkUrl(handle) : undefined,
    robots: p?.show_in_search === true ? ROBOTS_SHOWN : ROBOTS,
  });
  return null;
}

/** Owner 11-14 (Depop review item 10): below lg a section is a tab's plain panel (no card) and its tab names it, so the
 *  heading is for screen readers only there; from lg it is the card it always was. */
const PHONE_PLAIN = "max-lg:rounded-none max-lg:border-0 max-lg:p-0";

function Section({ id, title, icon: Icon, children }: { id: string; title: string; icon: typeof Star; children: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border border-border bg-card p-4 shadow-sm ${PHONE_PLAIN}`} aria-labelledby={id} data-pp-plain="">
      <h2 id={id} className="mb-3 flex items-center gap-2 text-ds-16 font-semibold text-foreground max-lg:sr-only">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * "Hire me" (owner 2026-11-04): Post a job with a direct offer to this Helpr, free for everyone. A guest signs up (or
 * logs in) and comes back here with ?hire=1, which continues the tap once; never on your own page. See src/lib/hireMe.ts.
 */
/** F067: the support account's one action: the support form (a person reads every message). Profiles have no Message button. */
function MessageSupportButton() {
  return (
    <div className="mt-4 max-lg:contents" data-testid="pp-message-support">
      <Button asChild size="phoneSm" className="btn-grad-primary w-full rounded-full max-lg:order-1 max-lg:w-auto max-lg:flex-1">
        <Link to="/support?topic=message"><MessageSquare className="mr-2 h-4 w-4" aria-hidden />Message support</Link>
      </Button>
    </div>
  );
}

function HireMeButton({ handle, signedIn }: { handle: string; signedIn: boolean }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const resumed = useRef(false);
  const hire = async () => {
    setBusy(true);
    const r = await hireTargetByHandle(handle);
    setBusy(false);
    if (r.id) navigate(hireOfferPath(r.id));
    else toast.error(r.error);
  };
  const resume = signedIn && params.get(HIRE_PARAM) === "1";
  useEffect(() => {
    if (!resume || resumed.current) return;
    resumed.current = true;
    const next = new URLSearchParams(params);
    next.delete(HIRE_PARAM);
    setParams(next, { replace: true });
    void hire();
    // Runs once per arrival with ?hire=1; hire and params are read at that moment on purpose.
  }, [resume]);
  const label = (<><Handshake className="mr-2 h-4 w-4" aria-hidden />Hire me</>);
  return (
    <div className="mt-4 max-lg:contents" data-testid="pp-hire">
      {signedIn ? (
        <Button type="button" size="phoneSm" className="btn-grad-primary w-full rounded-full max-lg:order-1 max-lg:w-auto max-lg:flex-1" disabled={busy} onClick={() => void hire()}>
          {label}
        </Button>
      ) : (
        <Button asChild size="phoneSm" className="btn-grad-primary w-full rounded-full max-lg:order-1 max-lg:w-auto max-lg:flex-1">
          <Link to={hireGuestHref(handle)}>{label}</Link>
        </Button>
      )}
      {/* F231 (audit 11-10): a guest asked what Hire me costs: free to look, pay only when you hire. */}
      <p className="mt-2 text-ds-13 text-muted-foreground max-lg:order-3 max-lg:mt-0 max-lg:w-full max-lg:text-ds-12">
        {signedIn ? "Offer a job directly. Your payment is held safely until the work is done." : "Free to look. You pay only when you hire, and your payment is held safely until the work is done."}
      </p>
      {/* Audit L3 (11-05): a guest who already has an account was sent to sign-up only. F068 (owner UI audit 11-09): and
          a new guest had no plain way to sign up, so both are offered: "New here? Join free · Have an account? Log in". */}
      {!signedIn && (
        <p className="mt-1 text-ds-13 text-muted-foreground max-lg:order-4 max-lg:mt-0 max-lg:w-full max-lg:text-ds-12" data-testid="pp-hire-join">
          {/* F230 (audit 11-10): Join free measured 58x16 and Log in 36x14; tap-44 gives each a 44px hit area in place. */}
          New here? <Link to={hireGuestHref(handle)} className="tap-44 font-semibold text-foreground underline underline-offset-2">Join free</Link>
          <span aria-hidden="true"> · </span>
          <span data-testid="pp-hire-login">Have an account? <Link to={hireGuestLoginHref(handle)} className="tap-44 font-semibold text-foreground underline underline-offset-2">Log in</Link></span>
        </p>
      )}
    </div>
  );
}

/** The skills line is free text ("Yard work, Handyman"); each comma-separated part is a chip. */
function skillChips(skills: string | null | undefined): string[] {
  return [...new Set((skills ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean))].slice(0, 20);
}

/** The profile's column from 900px (the shared public link column is a phone card, 448px). */
const PROFILE_WIDE = "min-[900px]:max-w-3xl";

/** How many listings show before "Show all N" (the rest load lazily from the same read). */
export const LISTINGS_FIRST = 24;

/** Owner 11-14 (Depop review item 10): where the phone tab bar pins, per shell. AppPage: under the 44px compact title
 *  bar (index.css .compact-title-bar), bleeding to its scroller's edges (px-3). Public header: under the fixed Navbar
 *  (PublicLayout's spacer height), bleeding over PublicHeaderPage's body padding. */
const TABS_STICKY_APP = "top-11 -mx-3 px-3";
const TABS_STICKY_PUBLIC = "top-[calc(max(var(--safe-area-top,0px),0.25rem)+var(--public-nav-h))] -mx-5 px-5 sm:-mx-8 sm:px-8";

/** One tab's part of the page: hidden on a phone while another tab shows; empty (an async part with nothing) takes no gap. */
function Pane({ hidden, children }: { hidden: string; children: React.ReactNode }) {
  return <div className={`empty:hidden ${hidden}`}>{children}</div>;
}

/** The server's stand-in name for a member with no public name (member_display_name's fallback), or no name at all. */
function isUnnamedProfile(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  return n === "" || /^a neighbor$/i.test(n);
}

function ProfileBody({ p, signedIn, isMe, ctaReady, viewerId = null, guestShell = false }: { p: PublicProfile; signedIn: boolean; isMe: boolean; ctaReady: boolean; viewerId?: string | null; guestShell?: boolean }) {
  // Audit 11-21 (P3): a member with no public name comes back as "A neighbor" (public_profile_by_handle's
  // member_display_name fallback), and its first word made "Share A's profile" and "A hasn't posted anything yet".
  const unnamed = isUnnamedProfile(p.name);
  const first = unnamed ? "this member" : p.name.trim().split(/\s+/)[0];
  const shareLabel = unnamed ? "Share this profile" : `Share ${first}'s profile`;
  const skills = skillChips(p.skills);
  const work = p.portfolio_urls ?? [];
  const listingTotal = Math.max(p.listing_count ?? 0, p.listings.length);
  const [allListings, setAllListings] = useState(false);
  const listingsShown = allListings ? p.listings : p.listings.slice(0, LISTINGS_FIRST);
  const trust = profileTrustLine(p);
  const team = isHelprTeam(p.handle);
  const since = memberSinceLabel(p.member_since);
  const nothing = p.listings.length + p.jobs.length + p.wanted.length + p.helpr.reviews.length + (p.helpr.jobs_done ?? 0) + work.length + skills.length + (p.bio ? 1 : 0) === 0;
  const tabs = profileTabs(p, { isMe: ctaReady && isMe, skillCount: skills.length });
  const [chosen, setChosen] = useState<ProfileTabKey | null>(null);
  const active = activeTab(tabs, chosen);
  const hide = (key: ProfileTabKey) => paneHiddenClass(tabs, active, key);
  return (
    // M5 (audit 11-05): from 900px the column widens so the shop and work grids are 4 across, not ~100 rows of 2.
    <div className={`${PUBLIC_LINK_COLUMN} ${PROFILE_WIDE} space-y-4 pb-8`} data-public-profile={p.handle}>
      {/* F069 (owner UI audit 11-09): the name showed twice at the top (the page title and again in this card). It is
          the page title (the one h1, the shell's title row); the card names itself to a screen reader instead.
          Owner 11-14 (Depop review item 10): below lg this is a compact header, no card: a 64px photo beside the
          name, trust and town lines, the bio clamped to two lines, and the actions in one row. On a phone (below sm)
          the h1 is kept for screen readers only (phoneHidesTitle) and the name is painted here beside the photo. */}
      <section className="rounded-2xl border border-border bg-card p-5 text-center shadow-sm max-lg:rounded-none max-lg:border-0 max-lg:p-0 max-lg:text-left" aria-label={p.name} data-pp-card="" data-pp-plain="">
        <div className="max-lg:flex max-lg:items-center max-lg:gap-3">
          <UserAvatar userId={p.handle} src={p.photo_url} name={p.name} pixelSize={96} className="mx-auto h-24 w-24 max-lg:mx-0 max-lg:h-16 max-lg:w-16 max-lg:shrink-0" />
          <div className="max-lg:flex max-lg:min-w-0 max-lg:flex-1 max-lg:flex-wrap max-lg:items-center max-lg:gap-x-2 max-lg:gap-y-0.5 max-lg:text-ds-13">
            <p className="hidden truncate text-ds-18 font-semibold leading-tight text-foreground max-sm:order-first max-sm:block max-sm:w-full" aria-hidden="true" data-testid="pp-name-phone">{p.name}</p>
            {p.business_name && <p className="text-ds-14 font-medium text-foreground max-lg:-order-3 max-lg:w-full max-lg:truncate max-lg:text-ds-13" data-testid="pp-business">{p.business_name}</p>}
            <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-muted-foreground max-lg:contents">
              {p.town && (
                <span className="inline-flex items-center gap-1" data-testid="pp-town"><MapPin className="h-3.5 w-3.5" aria-hidden />{p.town}</span>
              )}
              {since && <span>Member since {since}</span>}
              {p.stats.is_id_verified && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 max-lg:-order-1 max-lg:px-1.5 max-lg:py-0" style={ID_VERIFIED_PILL_STYLE}>
                  <IdVerifiedShield className="h-3.5 w-3.5" />
                  {ID_VERIFIED_LABEL}
                </span>
              )}
              {p.licensed && <span className="inline-flex items-center gap-1" data-testid="pp-licensed"><BadgeCheck className="h-3.5 w-3.5" aria-hidden />Licensed</span>}
              {p.insured && <span className="inline-flex items-center gap-1" data-testid="pp-insured"><BadgeCheck className="h-3.5 w-3.5" aria-hidden />Insured</span>}
            </div>
            {/* F067 (owner UI audit 11-09): the official support account says what it is, never "New on Helpr". */}
            {team ? (
              <p className="mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-semibold max-lg:-order-2 max-lg:mt-0 max-lg:px-2" data-testid="pp-team"
                style={{ color: "hsl(var(--bark))", backgroundColor: "hsl(var(--bark) / 0.1)" }}>
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden />Louisiana Helpr team
              </p>
            ) : (
              <p className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-foreground max-lg:-order-2 max-lg:mt-0" data-testid="pp-trust">
                {trust ? (<><Star className="h-3.5 w-3.5" aria-hidden />{trust}</>) : "New on Helpr"}
              </p>
            )}
          </div>
        </div>
        {p.bio && <PublicProfileBio bio={p.bio} />}
        {/* Below lg the skills move into the Work tab (pp-skills-phone), keeping the header short. */}
        {skills.length > 0 && (
          <ul className="mt-3 flex flex-wrap justify-center gap-1.5 max-lg:hidden" aria-label="Skills" data-testid="pp-skills">
            {skills.map((s) => (
              <li key={s} className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs">{s}</li>
            ))}
          </ul>
        )}
        {/* Below lg: one row, the main action beside Share, its note under the row. */}
        <div className="max-lg:mt-3 max-lg:flex max-lg:flex-wrap max-lg:items-center max-lg:gap-x-2 max-lg:gap-y-1.5" data-testid="pp-actions">
          {/* M3 (audit 11-05): your own page never flashes Hire me while your profile row loads. */}
          {ctaReady && !isMe && (team ? <MessageSupportButton /> : <HireMeButton handle={p.handle} signedIn={signedIn} />)}
          {ctaReady && <div className={isMe ? "mt-4 max-lg:mt-0 max-lg:w-full" : "mt-2 max-lg:order-2 max-lg:mt-0"}>
            <Button type="button" size="phoneSm" variant={isMe ? "default" : "outline"} className={isMe ? "btn-grad-primary w-full rounded-full" : "w-full rounded-full max-lg:w-auto"}
              aria-label={isMe ? undefined : shareLabel}
              onClick={() => void shareMyProfile(p.handle, isMe || unnamed ? null : p.name)}>
              <Share2 className="mr-2 h-4 w-4" aria-hidden />
              {isMe ? "Share my profile" : (<><span className="max-lg:hidden">{shareLabel}</span><span className="lg:hidden">Share</span></>)}
            </Button>
          </div>}
        </div>
      </section>

      {/* M3 (audit 11-05): your own view says what it is and what is still empty. */}
      {ctaReady && isMe && <PublicProfileOwnerSteps p={p} />}

      {/* Owner 11-14 (Depop review item 10): a phone shows one section at a time under tabs that pin to the top. */}
      <PublicProfileTabs tabs={tabs} active={active} onSelect={setChosen} stickyClassName={guestShell ? TABS_STICKY_PUBLIC : TABS_STICKY_APP} />

      {skills.length > 0 && (
        <Pane hidden={hide("work")}>
          <p className="mb-1.5 text-ds-13 font-medium text-muted-foreground lg:hidden" aria-hidden="true">Skills</p>
          <ul className="flex flex-wrap gap-1.5 lg:hidden" aria-label="Skills" data-testid="pp-skills-phone">
            {skills.map((s) => (
              <li key={s} className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs">{s}</li>
            ))}
          </ul>
        </Pane>
      )}

      <Pane hidden={hide("work")}>
        {work.length > 0 ? (
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm" aria-label="Recent work" data-testid="pp-work">
            <HelperWorkPhotos urls={work} />
          </section>
        ) : isMe ? (
          <section className="rounded-2xl border border-dashed border-border bg-card p-4 text-center" aria-label="Recent work" data-testid="pp-work-empty">
            <ImageIcon className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-ds-14 text-muted-foreground">Add photos of your work so people can see what you do.</p>
            <Button asChild variant="outline" size="sm" className="mt-3 rounded-full">
              <Link to="/profile?tab=profile">Add work photos</Link>
            </Button>
          </section>
        ) : null}
      </Pane>

      {/* H4 (owner 11-05): job after photos the Helpr picked, only while everyone on the job allows sharing. */}
      <Pane hidden={hide("work")}><PublicJobPhotos handle={p.handle} /></Pane>
      {ctaReady && isMe && <Pane hidden={hide("work")}><MyJobPhotosPicker handle={p.handle} /></Pane>}

      {nothing && (
        <p className="text-center text-ds-14 text-muted-foreground">{unnamed ? "This member" : first} hasn&apos;t posted anything yet.</p>
      )}

      {/* Profile leftovers 11-05: "See the whole sale" lands here now; the same moving-sale banner /user draws. */}
      <Pane hidden={hide("sale")}><PublicProfileMovingSale handle={p.handle} currentUserId={viewerId} isMe={isMe} /></Pane>

      {p.listings.length > 0 && (
        <Pane hidden={hide("sale")}>
          <Section id="pp-listings" title={`For sale · ${listingTotal}`} icon={ShoppingBag}>
            {/* Owner 11-14 (Depop review item 10): below lg a 3-across grid of square photos, 2px apart, the price on
                the photo; from lg the cards as before. */}
            <ul className="grid grid-cols-3 gap-0.5 lg:grid-cols-4 lg:gap-3" data-testid="pp-listings-grid">
              {listingsShown.map((l) => (
                <li key={l.id}>
                  {/* Guests may open an item (BUY-16); buying there asks them to sign up. */}
                  <Link to={`/declutter/item/${l.id}`} className="relative block h-full overflow-hidden bg-background lg:rounded-xl lg:border lg:border-border">
                    <div className="flex aspect-square w-full items-center justify-center bg-muted">
                      {l.photo_id ? (
                        <img loading="lazy" decoding="async" src={listingPhotoUrl(l.photo_id, 320)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ShoppingBag className="h-8 w-8 text-muted-foreground" aria-hidden />
                      )}
                    </div>
                    <div className="p-2 max-lg:pointer-events-none max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:bg-gradient-to-t max-lg:from-black/75 max-lg:to-transparent max-lg:px-1 max-lg:pb-1 max-lg:pt-5" data-pp-tile-text="">
                      <p className="truncate text-ds-14 font-semibold text-foreground max-lg:sr-only" title={l.title}>{l.title}</p>
                      {/* Owner 11-27 (polish audit #2, "One price, fee included"): ONE price, the buyer's total with the fee in it. */}
                      <p className="text-ds-13 text-muted-foreground max-lg:leading-tight">
                        <span data-pp-list-price="" className="text-ds-14 font-bold tabular-nums text-foreground max-lg:text-white">{buyerPriceLabel(l.current_price_cents)}</span><span className="max-lg:hidden">{l.area_label ? ` · ${l.area_label}` : ""}</span>
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            {!allListings && p.listings.length > LISTINGS_FIRST && (
              <Button type="button" variant="outline" className="mt-3 w-full rounded-full" data-testid="pp-listings-all" onClick={() => setAllListings(true)}>
                Show all {listingTotal}
              </Button>
            )}
          </Section>
        </Pane>
      )}

      {p.jobs.length > 0 && (
        <Pane hidden={hide("jobs")}>
          <Section id="pp-jobs" title="Open jobs" icon={Briefcase}>
            <ul className="flex flex-col gap-2">
              {p.jobs.map((j) => (
                <li key={j.id} className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-ds-15 font-semibold text-foreground">{j.title}</p>
                    <p className="text-ds-13 text-muted-foreground">
                      {[jobCategoryLabel(j.category), j.town, `$${Math.round(Number(j.budget))}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Button asChild size="sm" className="rounded-full shrink-0">
                    <Link to={guestAware(`/jobs?job=${j.id}`, signedIn)}>{signedIn ? "View" : "Apply"}</Link>
                  </Button>
                </li>
              ))}
            </ul>
            {!signedIn && <p className="mt-2 text-ds-13 text-muted-foreground">Free to sign up. We bring you right back.</p>}
          </Section>
        </Pane>
      )}

      {((p.helpr.jobs_done ?? 0) > 0 || p.helpr.reviews.length > 0) && (
        <Pane hidden={hide("work")}>
          <Section id="pp-helpr" title="Helpr work" icon={Star}>
            <p className="text-ds-14 text-foreground">
              {(p.helpr.jobs_done ?? 0)} job{p.helpr.jobs_done === 1 ? "" : "s"} done
            </p>
            {p.helpr.categories.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Kinds of work">
                {p.helpr.categories.map((c) => (
                  <li key={c} className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs">{jobCategoryLabel(c)}</li>
                ))}
              </ul>
            )}
            {/* M2 (audit 11-05): count, kind of work, month, the reply, and See all. */}
            <PublicProfileReviews reviews={p.helpr.reviews} total={reviewTotal(p)} first={first} />
          </Section>
        </Pane>
      )}

      {p.wanted.length > 0 && (
        <Pane hidden={hide("wanted")}>
          <Section id="pp-wanted" title="Looking for" icon={Search}>
            <ul className="flex flex-col gap-2">
              {p.wanted.map((w) => (
                <li key={w.id} className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ds-15 text-foreground">{w.what}</p>
                    <p className="text-ds-13 text-muted-foreground">up to {itemPriceLabel(w.max_price_cents)}</p>
                  </div>
                  {/* Audit L8 (11-05): "Sign up to reply" went to /declutter, not back to the post. Each post's own
                      reply (the Wanted quick-list, which answers THIS post once listed); a guest signs up first and
                      comes back to it. Never on your own page. */}
                  {!isMe && (
                    <Button asChild variant="outline" size="sm" className="shrink-0 rounded-full">
                      <Link to={guestAware(quickListHref(w), signedIn)} data-testid="pp-wanted-reply">I have this</Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {!signedIn && !isMe && <p className="mt-2 text-ds-13 text-muted-foreground">Free to sign up. We bring you right back to this post.</p>}
          </Section>
        </Pane>
      )}
    </div>
  );
}

export default function PublicProfilePage() {
  const { handle: raw } = useParams();
  const handle = handleFromPath(raw);
  const { user, isReady } = useAuthReady();
  // F066 (owner UI audit 11-09): a guest arriving from a shared link had no site header (no logo, Jobs, Declutter, Log
  // in / Join free) and no way to the rest of the site. A guest gets the public shell every other public page uses
  // (PublicHeaderPage: the site header and footer); a member keeps the app page. Decided only once auth is ready, so a
  // member's cold open never flashes the guest header.
  const guestShell = isReady && !user;
  const { profile: me, isLoading: meLoading } = useCurrentUser();
  const q = useQuery({
    queryKey: ["public-profile", handle],
    queryFn: () => fetchPublicProfile(handle as string),
    enabled: !!handle,
  });
  // L2 (audit 11-05): an old (retired) handle answers with the member's CURRENT handle; the address bar moves to it
  // (replace, so Back skips the old one) with the query and hash kept (?hire=1), and the page is not fetched twice.
  const current = q.data?.handle ?? null;
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!handle || !current || current === handle || !q.data) return;
    queryClient.setQueryData(["public-profile", current], q.data);
    navigate({ pathname: `/u/${encodeURIComponent(current)}`, search: location.search, hash: location.hash }, { replace: true });
  }, [handle, current, q.data, queryClient, navigate, location.search, location.hash]);
  // F282a (whole-app audit 11-10): the member's own "Your page" link landed on the stranger's "link may be old" card
  // when public_profile_by_handle hid them (unverified email, a ban, a seed/test account, under 18, anonymised:
  // profile_page_hidden, 20261105172514). The owner gets told it is their page and why it is hidden; everyone else
  // keeps the generic card, which never says why (test: publicProfileOwnHiddenPage).
  const ownHidden = !!handle && !!me?.handle && me.handle === handle;
  // Audit 11-21 (P20): the reason here said "once your email is verified and your account is in good standing" while
  // Home's "Your public profile" card said "under review", and the button read "Go to You". One explanation now, the
  // card's own words (YourPageLink: an unconfirmed email is the reason a member can act on, anything else is a review).
  const ownHiddenEmail = me?.email_verified === false;
  const unavailable = ownHidden ? (
    <EmptyState
      icon={UserX}
      title={t("yp.hidden")}
      body={ownHiddenEmail ? t("yp.hiddenEmail") : t("yp.hiddenOther")}
      action={
        <Button asChild className="btn-grad-primary rounded-full">
          {ownHiddenEmail
            ? <Link to="/profile?tab=security">{t("yp.hiddenEmailAction")}</Link>
            : <Link to="/profile">{t("yp.goToProfile")}</Link>}
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={UserX}
      title="This profile isn't available"
      body="The link may be old, or this profile isn't public right now."
      action={
        <Button asChild className="btn-grad-primary rounded-full">
          <Link to={user ? "/home" : "/"}>Go home</Link>
        </Button>
      }
    />
  );
  const isMe = !!me?.handle && !!q.data && me.handle === q.data.handle;
  const ctaReady = !user || !meLoading;
  // H5 (audit 11-05): a member on someone else's page gets /user's Save, Report and Block (never a guest, never you).
  const memberActions = user && q.data && ctaReady && !isMe
    ? <PublicProfileMemberActions handle={q.data.handle} name={q.data.name} currentUserId={user.id} />
    : null;
  const title = q.data?.name ?? "Profile";
  const body = (
    <>
      {/* The canonical names the current handle, never an old one the link still carries. */}
      <Meta p={q.data} handle={current ?? handle} />
      {!handle ? (
        unavailable
      ) : q.isPending ? (
        <PublicProfileSkeleton column={`${PUBLIC_LINK_COLUMN} ${PROFILE_WIDE}`} />
      ) : q.isError ? (
        <ErrorState variant="inline" title="We couldn't load this profile." onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        unavailable
      ) : (
        <ProfileBody p={q.data} signedIn={!!user} isMe={isMe} ctaReady={ctaReady} viewerId={user?.id ?? null} guestShell={guestShell} />
      )}
    </>
  );
  // Owner 11-14 (Depop review item 10): on a phone the name is painted beside the photo in the header (pp-name-phone),
  // so the title row keeps the h1 for screen readers only (phoneHidesTitle), once there is a profile to name.
  return guestShell ? (
    <PublicHeaderPage title={title} backTo="/" titleActions={memberActions} phoneHidesTitle={!!q.data} bottomPaddingClassName="pb-12 md:pb-16">
      {/* F253 (whole-app audit 11-10, measured B3g 11-12): /u/nobody shifted 0.405 when the skeleton gave way to the
          shorter "isn't available" card and the site footer slid up into the first screen. The body holds at least a
          screen's height in every state, so the footer starts below the fold and never moves into view on load
          (guard: publicProfileBodyHoldsScreen). */}
      <div className="min-h-[100dvh]" data-testid="pp-body">{body}</div>
    </PublicHeaderPage>
  ) : (
    <AppPage title={title} backTo={user ? "/home" : "/"} titleActions={memberActions} phoneHidesTitle={!!q.data}>
      {body}
    </AppPage>
  );
}
