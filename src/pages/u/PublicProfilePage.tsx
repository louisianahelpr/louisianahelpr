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
import { BadgeCheck, Briefcase, Handshake, ImageIcon, MapPin, Share2, ShoppingBag, Star, UserX, Search } from "lucide-react";
import { HelperWorkPhotos } from "@/components/profile/HelperWorkPhotos";
import AppPage from "@/components/AppPage";
import { PUBLIC_LINK_COLUMN } from "@/lib/pageColumn";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import UserAvatar from "@/components/UserAvatar";
import { ID_VERIFIED_LABEL, ID_VERIFIED_PILL_STYLE, IdVerifiedShield } from "@/components/profile/IdVerifiedPill";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useAuthReady } from "@/hooks/useAuthReady";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { signupUrlFor } from "@/lib/jobIntent";
import { jobCategoryLabel } from "@/lib/jobCategories";
import { itemPriceLabel } from "@/lib/declutter/distance";
import {
  fetchPublicProfile,
  handleFromPath,
  listingPhotoUrl,
  profileLinkUrl,
  shareMyProfile,
  type PublicProfile,
} from "@/lib/profileLink/api";
import { HIRE_PARAM, hireGuestHref, hireGuestLoginHref, hireOfferPath, hireTargetByHandle } from "@/lib/hireMe";
import { quickListHref } from "@/lib/declutter/wantedLinks";
import { PublicProfileReviews, reviewTotal } from "@/components/profile/publicProfile/PublicProfileReviews";
import { PublicProfileOwnerSteps } from "@/components/profile/publicProfile/PublicProfileOwnerSteps";
import { PublicProfileSkeleton } from "@/components/profile/publicProfile/PublicProfileSkeleton";
import { MyJobPhotosPicker, PublicJobPhotos } from "@/components/profile/publicProfile/PublicJobPhotos";

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

function Section({ id, title, icon: Icon, children }: { id: string; title: string; icon: typeof Star; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm" aria-labelledby={id}>
      <h2 id={id} className="mb-3 flex items-center gap-2 text-ds-16 font-semibold text-foreground">
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
    <div className="mt-4" data-testid="pp-hire">
      {signedIn ? (
        <Button type="button" className="btn-grad-primary w-full rounded-full" disabled={busy} onClick={() => void hire()}>
          {label}
        </Button>
      ) : (
        <Button asChild className="btn-grad-primary w-full rounded-full">
          <Link to={hireGuestHref(handle)}>{label}</Link>
        </Button>
      )}
      <p className="mt-2 text-ds-13 text-muted-foreground">Offer a job directly. Your payment is held safely until the work is done.</p>
      {/* Audit L3 (11-05): a guest who already has an account was sent to sign-up only. */}
      {!signedIn && (
        <p className="mt-1 text-ds-13 text-muted-foreground" data-testid="pp-hire-login">
          Have an account? <Link to={hireGuestLoginHref(handle)} className="font-semibold text-foreground underline underline-offset-2">Log in</Link>
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

function ProfileBody({ p, signedIn, isMe, ctaReady }: { p: PublicProfile; signedIn: boolean; isMe: boolean; ctaReady: boolean }) {
  const first = p.name.split(/\s+/)[0] || "this member";
  const skills = skillChips(p.skills);
  const work = p.portfolio_urls ?? [];
  const listingTotal = Math.max(p.listing_count ?? 0, p.listings.length);
  const [allListings, setAllListings] = useState(false);
  const listingsShown = allListings ? p.listings : p.listings.slice(0, LISTINGS_FIRST);
  const trust = profileTrustLine(p);
  const since = memberSinceLabel(p.member_since);
  const nothing = p.listings.length + p.jobs.length + p.wanted.length + p.helpr.reviews.length + (p.helpr.jobs_done ?? 0) + work.length + skills.length + (p.bio ? 1 : 0) === 0;
  return (
    // M5 (audit 11-05): from 900px the column widens so the shop and work grids are 4 across, not ~100 rows of 2.
    <div className={`${PUBLIC_LINK_COLUMN} ${PROFILE_WIDE} space-y-4 pb-8`} data-public-profile={p.handle}>
      <section className="rounded-2xl border border-border bg-card p-5 text-center shadow-sm" aria-labelledby="pp-name">
        <UserAvatar userId={p.handle} src={p.photo_url} name={p.name} pixelSize={96} className="mx-auto h-24 w-24" />
        <h2 id="pp-name" className="mt-3 text-xl font-semibold text-foreground">{p.name}</h2>
        {p.business_name && <p className="text-ds-14 font-medium text-foreground" data-testid="pp-business">{p.business_name}</p>}
        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {p.town && (
            <span className="inline-flex items-center gap-1" data-testid="pp-town"><MapPin className="h-3.5 w-3.5" aria-hidden />{p.town}</span>
          )}
          {since && <span>Member since {since}</span>}
          {p.stats.is_id_verified && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={ID_VERIFIED_PILL_STYLE}>
              <IdVerifiedShield className="h-3.5 w-3.5" />
              {ID_VERIFIED_LABEL}
            </span>
          )}
          {p.licensed && <span className="inline-flex items-center gap-1" data-testid="pp-licensed"><BadgeCheck className="h-3.5 w-3.5" aria-hidden />Licensed</span>}
          {p.insured && <span className="inline-flex items-center gap-1" data-testid="pp-insured"><BadgeCheck className="h-3.5 w-3.5" aria-hidden />Insured</span>}
        </div>
        <p className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-foreground" data-testid="pp-trust">
          {trust ? (<><Star className="h-3.5 w-3.5" aria-hidden />{trust}</>) : "New on Helpr"}
        </p>
        {p.bio && <p className="mt-3 whitespace-pre-line text-left text-ds-15 text-foreground [overflow-wrap:anywhere]" data-testid="pp-bio">{p.bio}</p>}
        {skills.length > 0 && (
          <ul className="mt-3 flex flex-wrap justify-center gap-1.5" aria-label="Skills" data-testid="pp-skills">
            {skills.map((s) => (
              <li key={s} className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs">{s}</li>
            ))}
          </ul>
        )}
        {/* M3 (audit 11-05): your own page never flashes Hire me while your profile row loads. */}
        {ctaReady && !isMe && <HireMeButton handle={p.handle} signedIn={signedIn} />}
        {ctaReady && <div className={isMe ? "mt-4" : "mt-2"}>
          <Button type="button" variant={isMe ? "default" : "outline"} className={isMe ? "btn-grad-primary w-full rounded-full" : "w-full rounded-full"}
            onClick={() => void shareMyProfile(p.handle, isMe ? null : p.name)}>
            <Share2 className="mr-2 h-4 w-4" aria-hidden />
            {isMe ? "Share my profile" : `Share ${first}'s profile`}
          </Button>
        </div>}
      </section>

      {/* M3 (audit 11-05): your own view says what it is and what is still empty. */}
      {ctaReady && isMe && <PublicProfileOwnerSteps p={p} />}

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

      {/* H4 (owner 11-05): job after photos the Helpr picked, only while everyone on the job allows sharing. */}
      <PublicJobPhotos handle={p.handle} />
      {ctaReady && isMe && <MyJobPhotosPicker handle={p.handle} />}

      {nothing && (
        <p className="text-center text-ds-14 text-muted-foreground">{first} hasn&apos;t posted anything yet.</p>
      )}

      {p.listings.length > 0 && (
        <Section id="pp-listings" title={`For sale · ${listingTotal}`} icon={ShoppingBag}>
          <ul className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-4" data-testid="pp-listings-grid">
            {listingsShown.map((l) => (
              <li key={l.id}>
                {/* Guests may open an item (BUY-16); buying there asks them to sign up. */}
                <Link to={`/declutter/item/${l.id}`} className="block overflow-hidden rounded-xl border border-border bg-background">
                  <div className="flex aspect-square w-full items-center justify-center bg-muted">
                    {l.photo_id ? (
                      <img loading="lazy" decoding="async" src={listingPhotoUrl(l.photo_id, 320)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ShoppingBag className="h-8 w-8 text-muted-foreground" aria-hidden />
                    )}
                  </div>
                  <div className="p-2">
                    <p className="truncate text-ds-14 font-semibold text-foreground" title={l.title}>{l.title}</p>
                    <p className="text-ds-13 text-muted-foreground">
                      {itemPriceLabel(l.price_cents)}{l.area_label ? ` · ${l.area_label}` : ""}
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
      )}

      {p.jobs.length > 0 && (
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
      )}

      {((p.helpr.jobs_done ?? 0) > 0 || p.helpr.reviews.length > 0) && (
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
      )}

      {p.wanted.length > 0 && (
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
      )}
    </div>
  );
}

export default function PublicProfilePage() {
  const { handle: raw } = useParams();
  const handle = handleFromPath(raw);
  const { user } = useAuthReady();
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
  const unavailable = (
    <EmptyState
      icon={UserX}
      title="This profile isn't available"
      body="The link may be old, or the account is no longer on Helpr."
      action={
        <Button asChild className="btn-grad-primary rounded-full">
          <Link to={user ? "/home" : "/"}>Go to Louisiana Helpr</Link>
        </Button>
      }
    />
  );
  return (
    <AppPage title={q.data?.name ?? "Profile"} backTo={user ? "/home" : "/"}>
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
        <ProfileBody p={q.data} signedIn={!!user} isMe={!!me?.handle && me.handle === q.data.handle} ctaReady={!user || !meLoading} />
      )}
    </AppPage>
  );
}
