import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { firstNameOf } from "@/lib/bookMe";
import { shareMyPage } from "@/lib/profileLink/api";
import { OwnProfileEditButton } from "./OwnProfileEditButton";

/**
 * Share your page on your own profile: opens the share sheet (or copies the link) for your one public page,
 * /u/<handle> (owner 2026-11-05, share-profile audit H5; it shared /book/<id> before). Same look as
 * OwnProfileEditButton beside it: icon only on a phone, so the header stays whole at 375.
 */
function BookMeShareButton({ displayName }: { displayName: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      data-testid="own-profile-book-me"
      aria-label="Share your page link"
      onClick={() => void shareMyPage(firstNameOf(displayName))}
      className="min-w-11 px-2 sm:px-3 shrink-0 gap-1.5 font-bold"
      style={{ color: "hsl(var(--bark))" }}
    >
      <Share2 className="w-4 h-4" aria-hidden />
      <span className="max-sm:hidden">Share my page</span>
    </Button>
  );
}

/**
 * The title-row actions on your own public profile: the share button
 * just before Edit, in one row. Lives here (not inline in UserProfile.tsx) so
 * that page stays under its component-size baseline.
 */
export function OwnProfileActions({ userId, displayName }: { userId: string | undefined; displayName: string }) {
  return (
    <div className="flex items-center gap-1">
      {userId && <BookMeShareButton displayName={displayName} />}
      <OwnProfileEditButton />
    </div>
  );
}
