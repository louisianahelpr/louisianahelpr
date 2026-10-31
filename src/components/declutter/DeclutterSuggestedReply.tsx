/**
 * "Suggested reply" in the seller's answer sheet (owner 2026-10-29, builder 26 feature 1). When the sheet opens on an
 * unanswered question, Claude drafts a reply from the listing (src/lib/declutter/aiReply.ts). The seller chooses:
 * Post this answer posts it as their answer, Edit puts it in the answer box to change. It is never posted on its own. A reply
 * with a blank (the listing does not say what was asked) can only be edited, so a "___" is never posted.
 */
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestSuggestedReply, suggestedReplyErrorMessage } from "@/lib/declutter/aiReply";

export function DeclutterSuggestedReply({
  questionId,
  sending,
  onSend,
  onEdit,
}: {
  questionId: string;
  sending: boolean;
  onSend: (text: string) => void;
  onEdit: (text: string) => void;
}) {
  const s = useQuery({
    queryKey: ["declutter", "suggested-reply", questionId],
    queryFn: () => requestSuggestedReply(questionId),
    // One suggestion per question while the app is open: each costs a model call.
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (s.isPending) {
    return (
      <div className="rounded-xl border border-dashed p-3 text-ds-13 text-muted-foreground" data-suggested-reply="loading" role="status">
        Writing a suggested reply from your listing…
      </div>
    );
  }
  // A failed suggestion says why and offers one more try (a tap, never automatic: each try is a model call).
  if (s.isError) {
    return (
      <div className="flex flex-wrap items-center gap-2" data-suggested-reply="error">
        <p className="min-w-0 flex-1 text-ds-13 text-muted-foreground">{suggestedReplyErrorMessage(s.error)}</p>
        <Button type="button" size="sm" variant="outline" disabled={s.isFetching} onClick={() => void s.refetch()}>Try again</Button>
      </div>
    );
  }
  const { reply, needsSeller } = s.data;
  return (
    <div className="space-y-2 rounded-xl border bg-[hsl(var(--primary)/0.04)] p-3" data-suggested-reply="ready">
      <p className="flex items-center gap-1.5 text-ds-13 font-semibold">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Suggested reply
      </p>
      <p className="text-ds-15 [overflow-wrap:anywhere]">{reply}</p>
      <p className="text-ds-13 text-muted-foreground">
        {needsSeller ? "Your listing doesn't say this. Fill in the blank before you post." : "Written from your listing. Check it before you send."}
      </p>
      <div className="flex gap-2">
        {/* AUD31-29: the same verb as the sheet's "Post answer" (it was "Send"): both post publicly at once. */}
        {!needsSeller && (
          <Button type="button" size="sm" disabled={sending} onClick={() => onSend(reply)}>
            Post this answer
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={() => onEdit(reply)}>
          Edit
        </Button>
      </div>
    </div>
  );
}
