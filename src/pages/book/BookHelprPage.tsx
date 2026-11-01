/**
 * /book/:userId: "Book me on Helpr" (owner-approved growth item, B59,
 * 2026-10-29). Open to anyone with the link, signed out included. Shows only
 * what the public profile gate already shows anon (masked "First L." name,
 * photo, town, skills, counts) plus the Helpr Guarantee. "Book <First>" opens
 * Post a job with a direct offer to this Helpr set; a visitor who is not
 * signed up goes through signup and comes back to the same offer. The link
 * card (og:*) comes from api/share.ts before JS runs.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { MapPin, Share2, Star, UserX } from "lucide-react";
import AppPage from "@/components/AppPage";
import { PUBLIC_LINK_COLUMN } from "@/lib/pageColumn";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import UserAvatar from "@/components/UserAvatar";
import { ID_VERIFIED_LABEL, ID_VERIFIED_PILL_STYLE, IdVerifiedShield } from "@/components/profile/IdVerifiedPill";
import { GuaranteePromise } from "@/components/guarantee/GuaranteePromise";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useAuthReady } from "@/hooks/useAuthReady";
import {
  bookCtaHref,
  bookMeLink,
  fetchBookCard,
  firstNameOf,
  isBookId,
  rememberBookingSource,
  shareBookMe,
  type BookCard,
} from "@/lib/bookMe";

const BOOK_PAGE_ROBOTS = "noindex, follow";

function BookMeta({ card, id }: { card: BookCard | null | undefined; id: string }) {
  const first = card ? firstNameOf(card.name) : null;
  usePageMeta({
    title: card ? `Book ${card.name} on Louisiana Helpr` : "Book a Helpr — Louisiana Helpr",
    description: card
      ? `${first} is on Louisiana Helpr${card.town ? ` in ${card.town}` : ""}. Book them for your next job.`
      : "Book a local Helpr on Louisiana Helpr.",
    canonical: isBookId(id) ? bookMeLink(id) : undefined,
    robots: BOOK_PAGE_ROBOTS,
  });
  return null;
}

/** "4.9 (12 reviews) · 8 jobs done", or nothing when there is nothing to say yet. */
function trustLine(card: Pick<BookCard, "jobsDone" | "reviewCount" | "avgRating">): string {
  const parts: string[] = [];
  if (card.reviewCount > 0 && card.avgRating != null) {
    parts.push(`${card.avgRating.toFixed(1)} (${card.reviewCount} review${card.reviewCount === 1 ? "" : "s"})`);
  }
  if (card.jobsDone > 0) parts.push(`${card.jobsDone} job${card.jobsDone === 1 ? "" : "s"} done`);
  return parts.join(" · ");
}

function BookBody({ card, signedIn, isMe }: { card: BookCard; signedIn: boolean; isMe: boolean }) {
  const first = firstNameOf(card.name);
  const trust = trustLine(card);
  return (
    <div className={`${PUBLIC_LINK_COLUMN} space-y-4 pb-8`}>
      <section className="rounded-2xl border border-border bg-card p-5 text-center shadow-sm" aria-labelledby="book-name">
        <UserAvatar userId={card.userId} src={card.avatarUrl} name={card.name} pixelSize={96} className="mx-auto h-24 w-24" />
        <h2 id="book-name" className="mt-3 text-xl font-semibold text-foreground">
          {card.name}
        </h2>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {card.town && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {card.town}
            </span>
          )}
          {card.isIdVerified && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={ID_VERIFIED_PILL_STYLE}>
              <IdVerifiedShield className="h-3.5 w-3.5" />
              {ID_VERIFIED_LABEL}
            </span>
          )}
        </div>
        {trust ? (
          <p className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-foreground" data-testid="book-trust">
            <Star className="h-3.5 w-3.5" aria-hidden />
            {trust}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground" data-testid="book-trust">New on Helpr</p>
        )}
        {card.skills.length > 0 && (
          <ul className="mt-3 flex flex-wrap justify-center gap-1.5" aria-label="Skills">
            {card.skills.map((s) => (
              <li key={s} className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs">
                {s}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 space-y-2.5">
          {isMe ? (
            <Button type="button" className="btn-grad-primary w-full rounded-full" onClick={() => void shareBookMe(card.userId, first)}>
              <Share2 className="mr-2 h-4 w-4" aria-hidden />
              Share your booking link
            </Button>
          ) : (
            <Button asChild className="btn-grad-primary w-full rounded-full">
              <Link to={bookCtaHref(card.userId, signedIn)} onClick={() => rememberBookingSource(card.userId)}>
                Book {first}
              </Link>
            </Button>
          )}
          {!signedIn && !isMe && (
            <p className="text-sm text-muted-foreground">Free to sign up. You set the price, and {first} says yes or no.</p>
          )}
        </div>
      </section>
      <GuaranteePromise />
    </div>
  );
}

export default function BookHelprPage() {
  const { userId = "" } = useParams();
  const { user } = useAuthReady();
  const card = useQuery({
    queryKey: ["book", "card", userId],
    queryFn: () => fetchBookCard(userId),
    enabled: isBookId(userId),
  });
  const unavailable = (
    <EmptyState
      icon={UserX}
      title="This Helpr isn't available"
      body="The link may be old, or the account is no longer on Helpr. You can still post a job for anyone nearby."
      action={
        <Button asChild className="btn-grad-primary rounded-full">
          <Link to={user ? "/post-job" : "/signup"}>Post a job</Link>
        </Button>
      }
    />
  );
  return (
    <AppPage title="Book a Helpr" backTo={user ? "/home" : "/"}>
      <BookMeta card={card.data} id={userId} />
      {!isBookId(userId) ? (
        unavailable
      ) : card.isPending ? (
        // A status line, not card bones (loadingStateShape): the same link can land on the
        // card or on "This Helpr isn't available", and bones shaped like one jump into the
        // other. Measured anon: /book/<test Helpr> resolves to the unavailable state.
        <p role="status" className={`${PUBLIC_LINK_COLUMN} text-center text-ds-14 text-muted-foreground`} data-testid="book-loading">
          Loading this Helpr…
        </p>
      ) : card.isError ? (
        <ErrorState variant="inline" title="We couldn't load this Helpr." onRetry={() => void card.refetch()} />
      ) : !card.data ? (
        unavailable
      ) : (
        <BookBody card={card.data} signedIn={!!user} isMe={user?.id === card.data.userId} />
      )}
    </AppPage>
  );
}
