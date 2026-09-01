import { FileText } from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { TabsContent } from "@/components/ui/tabs";
import type { Profile } from "../adminUserHelpers";

interface DocumentsTabProps {
  viewProfile: Profile;
  idDocSignedUrl: string | null;
}

export function DocumentsTab({ viewProfile, idDocSignedUrl }: DocumentsTabProps) {
  return (
    <TabsContent value="documents" className="space-y-6 mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
      {/* ID Document */}
      <div className="space-y-2">
        <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
          <FileText className="w-4 h-4" /> ID Document
        </h4>
        {viewProfile.id_document_url ? (
          <div className="rounded-ds-md border border-border overflow-hidden bg-secondary/20">
            {idDocSignedUrl ? (
              /\.(jpg|jpeg|png|gif|webp)$/i.test(viewProfile.id_document_url) ? (
                <a href={idDocSignedUrl} target="_blank" rel="noopener noreferrer">
                  <img loading="lazy" decoding="async" src={idDocSignedUrl} alt="ID Document" className="max-h-64 w-auto mx-auto object-contain hover:opacity-90 transition-opacity" />
                </a>
              ) : (
                <div className="p-4 flex items-center gap-3">
                  <FileText className="w-8 h-8 text-primary" />
                  <div>
                    <p className="text-ds-13 font-medium text-foreground break-all">{viewProfile.id_document_url.split("/").pop()}</p>
                    <a href={idDocSignedUrl} target="_blank" rel="noopener noreferrer" className="text-ds-11 text-primary underline">
                      Open document ↗
                    </a>
                  </div>
                </div>
              )
            ) : (
              <div className="p-4 text-center">
                <p className="text-ds-11 text-muted-foreground">Loading document…</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-ds-11 text-muted-foreground italic">Not provided</p>
        )}
      </div>

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
             non-image ID-document branch above already uses — always reaches
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
            <a
              href={viewProfile.avatar_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-ds-11 text-primary underline"
            >
              Open original ↗
            </a>
          </div>
        ) : (
          <p className="text-ds-11 text-muted-foreground italic">Not provided</p>
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
              return isImage ? (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="aspect-square rounded-ds-md overflow-hidden border border-border hover:border-primary transition-colors block group">
                  <img loading="lazy" decoding="async" src={url} alt={`Portfolio item ${i + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                </a>
              ) : (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="aspect-square rounded-ds-md border border-border flex flex-col items-center justify-center bg-secondary/30 px-2 hover:border-primary transition-colors">
                  <FileText className="w-6 h-6 text-muted-foreground mb-1" />
                  <p className="text-muted-foreground text-ds-11 text-center truncate w-full">{fileName}</p>
                </a>
              );
            })}
          </div>
        ) : (
          <p className="text-ds-11 text-muted-foreground italic">Not provided</p>
        )}
      </div>
    </TabsContent>
  );
}
