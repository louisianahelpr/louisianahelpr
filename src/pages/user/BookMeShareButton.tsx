import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { firstNameOf, shareBookMe } from "@/lib/bookMe";

/**
 * "Book me on Helpr" (B59) on your own profile: opens the share sheet (or
 * copies the link) for your /book page. Same look as OwnProfileEditButton
 * beside it: icon only on a phone, so the header stays whole at 375.
 */
export function BookMeShareButton({ userId, displayName }: { userId: string; displayName: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      data-testid="own-profile-book-me"
      aria-label="Share your Book me link"
      onClick={() => void shareBookMe(userId, firstNameOf(displayName))}
      className="min-w-11 px-2 sm:px-3 shrink-0 gap-1.5 font-bold"
      style={{ color: "hsl(var(--bark))" }}
    >
      <Share2 className="w-4 h-4" aria-hidden />
      <span className="max-sm:hidden">Book me link</span>
    </Button>
  );
}
