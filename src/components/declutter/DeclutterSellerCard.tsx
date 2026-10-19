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
import { fetchSellerCard, fetchSellerRating } from "@/lib/declutter/api";
import { formatName } from "@/lib/utils";

/** "Joined March 2025" from an ISO date; null when there is no usable date. */
export function joinedLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `Joined ${d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/Chicago" })}`;
}

export function DeclutterSellerCard({ sellerId }: { sellerId: string }) {
  const card = useQuery({ queryKey: ["declutter", "seller-card", sellerId], queryFn: () => fetchSellerCard(sellerId) });
  const stats = useQuery({ queryKey: ["declutter", "seller-stats", sellerId], queryFn: () => fetchSellerRating(sellerId) });
  const loading = card.isLoading || stats.isLoading;
  const reviews = stats.data?.count ?? 0;
  const name = formatName(card.data?.name, "A neighbor");
  const joined = joinedLabel(card.data?.joinedAt);
  return (
    <Link
      to={`/user/${sellerId}`}
      data-seller-card=""
      aria-label={loading ? "See the seller" : `See the seller, ${name}`}
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
                <Star className="h-3.5 w-3.5 text-amber-500" fill="currentColor" aria-hidden />
                <span className="font-semibold">{(stats.data?.avg ?? 0).toFixed(1)}</span>
                <span className="text-muted-foreground">
                  <span className="sr-only"> stars from </span>
                  <span aria-hidden>·</span> {reviews} review{reviews === 1 ? "" : "s"}
                </span>
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
