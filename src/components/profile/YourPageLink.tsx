import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/nativeShare";
import { MY_HANDLE_KEY, ensureMyHandle, profileLinkLabel, profileLinkUrl, shareMyProfile } from "@/lib/profileLink/api";


/**
 * "Your page: louisianahelpr.com/u/<handle>" with Copy and Share (owner 2026-11-04: profile links are made
 * at sign-up and easy to find, never something a member has to create). Shown on the member's own profile
 * and on Declutter's Selling tab. The handle comes from sign-up; rpc_ensure_my_handle only returns it (and
 * makes one for the rare member the sign-up trigger could not name). Changing it once stays in Settings
 * (ProfileLinkRow). Renders nothing until the handle is known, and nothing on a failed read.
 */
export function YourPageLink({ name, className = "" }: { name?: string | null; className?: string }) {
  const { data: handle } = useQuery({
    queryKey: MY_HANDLE_KEY,
    queryFn: async () => {
      const out = await ensureMyHandle();
      if (out.handle) return out.handle;
      throw new Error("handle_unavailable");
    },
    staleTime: 10 * 60_000,
    retry: 1,
  });
  if (!handle) return null;
  const copy = async () => {
    if (await copyToClipboard(profileLinkUrl(handle))) toast.success("Link copied");
    else toast.error("Couldn't copy the link. Press and hold it to copy.");
  };
  return (
    <section aria-label="Your page" data-your-page-link="" className={`rounded-2xl border border-border/60 px-4 py-3 flex flex-col gap-2 ${className}`}>
      <p className="text-ds-13 text-muted-foreground min-w-0">
        Your page:{" "}
        {/* In-app route: the page opens here, never in a browser outside the app. */}
        <Link to={`/u/${encodeURIComponent(handle)}`} className="link-standard font-semibold text-foreground break-all">
          {profileLinkLabel(handle)}
        </Link>
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void copy()} data-your-page-copy="">
          <Copy className="w-4 h-4" aria-hidden /> Copy
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void shareMyProfile(handle, name)} data-your-page-share="">
          <Share2 className="w-4 h-4" aria-hidden /> Share
        </Button>
      </div>
    </section>
  );
}
