import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { TabsContent } from "@/components/ui/tabs";
import type { Profile } from "../adminUserHelpers";
import { isStorageObjectPath, openableDocumentUrl, safeDocumentUrl } from "@/lib/storagePath";
import { openSignedDocument } from "@/lib/openSignedDocument";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { toast } from "sonner";

interface DocumentsTabProps {
  viewProfile: Profile;
}

/**
 * complete-signup stores a portfolio upload as a bare `user-documents` storage
 * path (same private bucket as credential documents), not a public URL — see
 * src/lib/portfolioStorage.ts's `portfolioObjectName` doc comment. Before this
 * fix those rows fell through to "Link withheld (not https)" forever, because
 * safeDocumentUrl only ever passes an https: URL or a raster data: URL and
 * nothing here signed the storage path the way AdminCredentialQueue's
 * SignedOpenLink/DocPreview already do for id/license/insurance documents in
 * the same bucket. 0 such rows measured on prod 2026-09-23 (docs/OPEN.md),
 * so this fixes dormant risk, not a currently-visible defect.
 */
function SignedPortfolioTile({ path, fileName }: { path: string; fileName: string }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    await openSignedDocument({
      open: (url, target) => window.open(url, target),
      sign: async () => {
        if (!isStorageObjectPath(path)) return null;
        const { data, error } = await supabase.storage
          .from("user-documents")
          .createSignedUrl(path, 300);
        if (error) report(error, { tags: { source: "DocumentsTab.SignedPortfolioTile" } });
        return error || !data ? null : data.signedUrl;
      },
      toastError: (msg) => toast.error(msg),
    });
    setBusy(false);
  };
  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className="aspect-square rounded-ds-md border border-border flex flex-col items-center justify-center bg-secondary/30 px-2 ctl-tint disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-6 h-6 text-muted-foreground mb-1 animate-spin" /> : <FileText className="w-6 h-6 text-muted-foreground mb-1" />}
      <p title={fileName} className="text-muted-foreground text-ds-11 text-center truncate w-full">{fileName}</p>
    </button>
  );
}

export function DocumentsTab({ viewProfile }: DocumentsTabProps) {
  return (
    <TabsContent value="documents" className="space-y-6 mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
      {/* Profile Picture */}
      <div className="space-y-2">
        <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide">Profile Picture</h4>
        {viewProfile.avatar_url ? (
          /* Migrated onto the shared `<UserAvatar>` (2026-08-31) — the one
             surface in this lane where that needed thinking about, because
             here the avatar is EVIDENCE, not decoration: an admin opens this
             tab to see what the member actually uploaded.

             Showing the raw file would have kept this panel painting the exact
             blank block the fix exists to remove; showing only a monogram
             would have hidden the artifact under review. So both ship: the
             guarded avatar identifies the account at a glance, and the
             "Open original ↗" link below it — the same affordance the
             credential documents below use — always reaches
             the unaltered object. The monogram appearing here is itself
             informative: it means the upload carries no image content, which
             is a fact worth an admin's attention. */
          <div className="space-y-1.5">
            <UserAvatar
              userId={viewProfile.user_id}
              src={viewProfile.avatar_url}
              name={viewProfile.full_name}
              pixelSize={128}
              aria-hidden
              className="w-32 h-32 rounded-ds-md border-2 border-border"
              fallbackClassName="rounded-ds-md text-ds-24 ring-0"
            />
            {/* avatar_url is the member's own column (no shape CHECK): the raw
                value is never an href. A refused one says so. */}
            {safeDocumentUrl(viewProfile.avatar_url) ? (
              <a
                href={openableDocumentUrl(viewProfile.avatar_url) ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-ds-11 text-primary underline"
              >
                Open original ↗
              </a>
            ) : (
              <p className="text-ds-11 text-muted-foreground">Original not openable (not an https link)</p>
            )}
          </div>
        ) : (
          <p className="text-ds-11 text-muted-foreground">Not provided</p>
        )}
      </div>

      {/* Portfolio */}
      <div className="space-y-2">
        <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
          <FileText className="w-4 h-4" /> Portfolio & Documents ({(viewProfile.portfolio_urls || []).length})
        </h4>
        {(viewProfile.portfolio_urls || []).length > 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {(viewProfile.portfolio_urls || []).map((url: string, i: number) => {
              const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
              const fileName = url.split("/").pop() || "Document";
              // portfolio_urls is the member's own column (no shape CHECK):
              // anything but https / a raster data: image is shown, not linked
              // — UNLESS it is a bare user-documents storage path (a legacy
              // complete-signup upload), which is signed at display time.
              if (!safeDocumentUrl(url)) {
                if (isStorageObjectPath(url)) {
                  return <SignedPortfolioTile key={i} path={url} fileName={fileName} />;
                }
                return (
                  <div key={i} className="aspect-square rounded-ds-md border border-border flex flex-col items-center justify-center bg-secondary/30 px-2">
                    <FileText className="w-6 h-6 text-muted-foreground mb-1" />
                    <p className="text-muted-foreground text-ds-11 text-center">Link withheld (not https)</p>
                  </div>
                );
              }
              return isImage ? (
                <a key={i} href={openableDocumentUrl(url) ?? undefined} target="_blank" rel="noopener noreferrer" className="aspect-square rounded-ds-md overflow-hidden border border-border hover:border-primary transition-colors block group">
                  <img loading="lazy" decoding="async" src={url} alt={`Portfolio item ${i + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                </a>
              ) : (
                <a key={i} href={openableDocumentUrl(url) ?? undefined} target="_blank" rel="noopener noreferrer" className="aspect-square rounded-ds-md border border-border flex flex-col items-center justify-center bg-secondary/30 px-2 hover:border-primary transition-colors">
                  <FileText className="w-6 h-6 text-muted-foreground mb-1" />
                  <p title={fileName} className="text-muted-foreground text-ds-11 text-center truncate w-full">{fileName}</p>
                </a>
              );
            })}
          </div>
        ) : (
          <p className="text-ds-11 text-muted-foreground">Not provided</p>
        )}
      </div>
    </TabsContent>
  );
}
