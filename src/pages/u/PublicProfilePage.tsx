/**
 * /u/:handle: a member's shareable profile (LEAD-PROFILE-LINK, owner 2026-10-31 ~10:50 PM, OWNER-DECISIONS
 * "Shareable profile link"). Open to anyone with the link, signed out included: the member's public name, photo,
 * member since and public stats, their live Declutter listings, their open jobs (town only), their Helpr work
 * (jobs done, categories, reviews) and their public Wanted posts. Everything comes from ONE read,
 * public_profile_by_handle (20261101041833), which never returns contacts, addresses, coordinates or test data.
 *
 * Buying, applying and replying ask a guest to sign up and bring them back (signupUrlFor). The link card (og:*)
 * comes from api/share.ts before JS runs.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Briefcase, Share2, ShoppingBag, Star, UserX, Search } from "lucide-react";
import AppPage from "@/components/AppPage";
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

const ROBOTS = "noindex, follow";

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
    robots: ROBOTS,
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

function ProfileBody({ p, signedIn, isMe }: { p: PublicProfile; signedIn: boolean; isMe: boolean }) {
  const first = p.name.split(/\s+/)[0] || "this member";
  const trust = profileTrustLine(p);
  const since = memberSinceLabel(p.member_since);
  const nothing = p.listings.length + p.jobs.length + p.wanted.length + p.helpr.reviews.length + (p.helpr.jobs_done ?? 0) === 0;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-8" data-public-profile={p.handle}>
      <section className="rounded-2xl border border-border bg-card p-5 text-center shadow-sm" aria-labelledby="pp-name">
        <UserAvatar userId={p.handle} src={p.photo_url} name={p.name} pixelSize={96} className="mx-auto h-24 w-24" />
        <h2 id="pp-name" className="mt-3 text-xl font-semibold text-foreground">{p.name}</h2>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {since && <span>Member since {since}</span>}
          {p.stats.is_id_verified && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={ID_VERIFIED_PILL_STYLE}>
              <IdVerifiedShield className="h-3.5 w-3.5" />
              {ID_VERIFIED_LABEL}
            </span>
          )}
        </div>
        <p className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-foreground" data-testid="pp-trust">
          {trust ? (<><Star className="h-3.5 w-3.5" aria-hidden />{trust}</>) : "New on Helpr"}
        </p>
        <div className="mt-4">
          <Button type="button" variant={isMe ? "default" : "outline"} className={isMe ? "btn-grad-primary w-full rounded-full" : "w-full rounded-full"}
            onClick={() => void shareMyProfile(p.handle, isMe ? null : p.name)}>
            <Share2 className="mr-2 h-4 w-4" aria-hidden />
            {isMe ? "Share my profile" : `Share ${first}'s profile`}
          </Button>
        </div>
      </section>

      {nothing && (
        <p className="text-center text-ds-14 text-muted-foreground">{first} hasn&apos;t posted anything yet.</p>
      )}

      {p.listings.length > 0 && (
        <Section id="pp-listings" title="For sale" icon={ShoppingBag}>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {p.listings.map((l) => (
              <li key={l.id}>
                {/* Guests may open an item (BUY-16); buying there asks them to sign up. */}
                <Link to={`/declutter/item/${l.id}`} className="block overflow-hidden rounded-xl border border-border bg-background">
                  <div className="flex aspect-square w-full items-center justify-center bg-muted">
                    {l.photo_id ? (
                      <img src={listingPhotoUrl(l.photo_id)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <ShoppingBag className="h-8 w-8 text-muted-foreground" aria-hidden />
                    )}
                  </div>
                  <div className="p-2">
                    <p className="truncate text-ds-14 font-semibold text-foreground">{l.title}</p>
                    <p className="text-ds-13 text-muted-foreground">
                      {itemPriceLabel(l.price_cents)}{l.area_label ? ` · ${l.area_label}` : ""}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
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
          {p.helpr.reviews.length > 0 && (
            <ul className="mt-3 flex flex-col gap-3">
              {p.helpr.reviews.map((r, i) => (
                <li key={`${r.created_at}-${i}`} className="rounded-xl border border-border bg-background p-3">
                  <p className="text-ds-13 font-semibold text-foreground">
                    <span aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(r.rating)}{"☆".repeat(Math.max(0, 5 - r.rating))}</span>
                    {" · "}{r.reviewer_name}
                  </p>
                  {r.feedback && <p className="mt-1 text-ds-14 text-foreground">{r.feedback}</p>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {p.wanted.length > 0 && (
        <Section id="pp-wanted" title="Looking for" icon={Search}>
          <ul className="flex flex-col gap-2">
            {p.wanted.map((w) => (
              <li key={w.id} className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
                <p className="min-w-0 flex-1 truncate text-ds-15 text-foreground">{w.what}</p>
                <p className="shrink-0 text-ds-13 text-muted-foreground">up to {itemPriceLabel(w.max_price_cents)}</p>
              </li>
            ))}
          </ul>
          {!signedIn && (
            <Button asChild variant="outline" size="sm" className="mt-3 rounded-full">
              <Link to={signupUrlFor("/declutter")}>Have one? Sign up to reply</Link>
            </Button>
          )}
        </Section>
      )}
    </div>
  );
}

export default function PublicProfilePage() {
  const { handle: raw } = useParams();
  const handle = handleFromPath(raw);
  const { user } = useAuthReady();
  const { profile: me } = useCurrentUser();
  const q = useQuery({
    queryKey: ["public-profile", handle],
    queryFn: () => fetchPublicProfile(handle as string),
    enabled: !!handle,
  });
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
    <AppPage title="Profile" backTo={user ? "/home" : "/"}>
      <Meta p={q.data} handle={handle} />
      {!handle ? (
        unavailable
      ) : q.isPending ? (
        <p role="status" className="mx-auto w-full max-w-md text-center text-ds-14 text-muted-foreground">Loading this profile…</p>
      ) : q.isError ? (
        <ErrorState variant="inline" title="We couldn't load this profile." onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        unavailable
      ) : (
        <ProfileBody p={q.data} signedIn={!!user} isMe={!!me?.handle && me.handle === q.data.handle} />
      )}
    </AppPage>
  );
}
