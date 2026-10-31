/**
 * The seller card on a Declutter item (owner, 2026-10-19, as on Marketplace /
 * OfferUp / Mercari): photo, name ("First L."), stars ONLY when the seller has
 * reviews, and "Joined <month year>". No response time: we hold no reply-time
 * figure for another member, and an invented one would be a lie. The whole
 * card opens the seller's profile. Messages open after checkout, so there is
 * no "Message seller" here; questions go in the public Questions below.
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Star } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchSellerCard, fetchSellerRating, fetchSellerReviewTags } from "@/lib/declutter/api";
import { topReviewTags } from "@/lib/declutter/reviewTags";
import { formatName } from "@/lib/utils";

/** "Joined March 2025" from an ISO date; null when there is no usable date. */
function joinedLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `Joined ${d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/Chicago" })}`;
}

/** `noun`: who the card is about, for its accessible name (the job page reuses this card for the poster). */
export function DeclutterSellerCard({ sellerId, noun = "seller" }: { sellerId: string; noun?: "seller" | "poster" | "Helpr" }) {
  const card = useQuery({ queryKey: ["declutter", "seller-card", sellerId], queryFn: () => fetchSellerCard(sellerId) });
  const stats = useQuery({ queryKey: ["declutter", "seller-stats", sellerId], queryFn: () => fetchSellerRating(sellerId) });
  // Q2265: what buyers said most (Declutter only; never on the job page's poster card). A failed read shows nothing.
  const tagLists = useQuery({
    queryKey: ["declutter", "seller-tags", sellerId],
    queryFn: () => fetchSellerReviewTags(sellerId),
    enabled: noun === "seller",
  });
  const top = topReviewTags(tagLists.data ?? []);
  const loading = card.isLoading || stats.isLoading;
  const reviews = stats.data?.count ?? 0;
  const name = formatName(card.data?.name, "A neighbor");
  const joined = joinedLabel(card.data?.joinedAt);
  // DA-18: the link's name is all a screen reader says of the card, so the rating is in it (a sentence, not "4.0 · 1 review").
  const ratingWords = reviews > 0 ? `, ${(stats.data?.avg ?? 0).toFixed(1)} stars from ${reviews} review${reviews === 1 ? "" : "s"}` : "";
  return (
    <Link
      to={`/user/${sellerId}`}
      data-seller-card=""
      aria-label={loading ? `See the ${noun}` : `See the ${noun}, ${name}${ratingWords}`}
      className="flex min-h-[72px] items-center gap-3 rounded-2xl border border-border bg-card p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {loading ? (
        <>
          <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
          <span className="flex-1 space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-36" />
          </span>
        </>
      ) : (
        <>
          <UserAvatar userId={sellerId} src={card.data?.avatarUrl} name={card.data?.name ?? name} className="h-12 w-12 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold" title={name}>{name}</span>
            {/* Two short lines, never one that wraps a stray "·" at 320. */}
            {reviews > 0 && (
              <span data-seller-rating="" className="flex items-center gap-1 text-xs text-foreground">
                <Star className="h-3.5 w-3.5 fill-primary text-primary" aria-hidden />
                <span className="font-semibold">{(stats.data?.avg ?? 0).toFixed(1)}</span>
                <span className="text-muted-foreground">
                  <span className="sr-only"> stars from </span>
                  <span aria-hidden>·</span> {reviews} review{reviews === 1 ? "" : "s"}
                </span>
              </span>
            )}
            {top.length > 0 && (
              <span data-seller-tags="" className="block truncate text-xs text-foreground">
                {top.map((t) => `${t.label} (${t.count})`).join(" · ")}
              </span>
            )}
            {joined && <span className="block text-xs text-muted-foreground">{joined}</span>}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </>
      )}
    </Link>
  );
}
