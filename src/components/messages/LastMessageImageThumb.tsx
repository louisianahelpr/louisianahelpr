import { useEffect, useState } from "react";
import { getMessageAttachmentSignedUrl } from "@/lib/messageAttachments";
import { report } from "@/lib/errorLogger";

// Moved out of ConversationRow.tsx unchanged (Q806, god-component ratchet). The
// report tag keeps its old source name so existing Sentry history still matches.

/**
 * Tiny 32×32 image preview for the conversation-row "Photo" case.
 *
 * `messages.attachment_url` stores a storage path, not a URL — but the
 * parent (`loadConversations` in Messages.tsx) now batches the signed-URL
 * resolution into a single `createSignedUrls` call and passes the URL in
 * via `preResolvedUrl`. We only fall back to a per-row fetch when that
 * batched URL is absent (legacy callers or a race where the batch errored
 * on just this path) — eliminating the old N+1 across image-last-message
 * conversations in the inbox.
 */
export function LastMessageImageThumb({
  path,
  preResolvedUrl,
}: {
  path: string;
  preResolvedUrl?: string | null;
}) {
  // Seed from the parent-batched URL when present — no fetch at all in
  // the common case. We keep the per-row fetch as a fallback so removing
  // a thread from the batch (or a partial failure) still renders.
  const [url, setUrl] = useState<string | null>(preResolvedUrl ?? null);
  useEffect(() => {
    // If the parent supplied a URL, use it as-is (sync prop changes too,
    // since `loadConversations` may re-run with a refreshed batch).
    if (preResolvedUrl !== undefined && preResolvedUrl !== null) {
      setUrl(preResolvedUrl);
      return;
    }
    // Only pay for a per-row round-trip when the batch didn't cover us.
    let cancelled = false;
    void getMessageAttachmentSignedUrl(path)
      .then((signed) => {
        if (!cancelled) setUrl(signed);
      })
      .catch((err) => {
        // Leave `url` null — the thumbnail box below already renders as
        // an empty placeholder when `url` is null, so a failed sign-url
        // just falls into that existing state instead of showing a
        // broken-image icon. Still logged so silent failures surface.
        if (cancelled) return;
        report(err, {
          severity: "warning",
          tags: { source: "ConversationRow.LastMessageImageThumb" },
        });
      });
    return () => { cancelled = true; };
  }, [path, preResolvedUrl]);
  return (
    <div
      className="shrink-0 w-8 h-8 rounded-ds-sm overflow-hidden"
      style={{
        background: "hsl(var(--ivory-sand) / 0.6)",
        border: "0.5px solid hsl(var(--olivewood) / 0.18)",
      }}
      aria-hidden="true"
    >
      {url ? (
        <img
          loading="lazy"
          decoding="async"
          src={url}
          alt=""
          className="w-full h-full object-cover"
        />
      ) : null}
    </div>
  );
}
