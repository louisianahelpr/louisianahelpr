/**
 * The one-time "Turn on trades for all your listings?" card on the Selling tab (owner decision 2026-11-08). Shown
 * until the seller answers it, on any device; the answer is kept on the account (src/lib/declutter/tradesPrompt.ts,
 * server 20261108193632). Turn on opens the seller's live priced listings to trades and makes it their listing
 * default; open offers are not touched. Not now hides it for good.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { answerTradesPrompt, fetchTradesPromptDue, tradesPromptKey } from "@/lib/declutter/tradesPrompt";

export function DeclutterTradesPrompt({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const due = useQuery({ queryKey: tradesPromptKey(userId), queryFn: () => fetchTradesPromptDue(userId), staleTime: 5 * 60_000 });
  const answer = useMutation({
    mutationFn: answerTradesPrompt,
    onSuccess: (n, on) => {
      qc.setQueryData(tradesPromptKey(userId), false);
      if (on) toast(n === 1 ? "Trades are on for 1 listing and for new ones." : `Trades are on for ${n} listings and for new ones.`);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  if (due.data !== true) return null;
  return (
    <section className="space-y-3 rounded-[20px] border border-border bg-card p-4" aria-labelledby="trades-prompt-head" data-trades-prompt="">
      <div className="space-y-1">
        <h2 id="trades-prompt-head" className="text-base font-semibold">Turn on trades for all your listings?</h2>
        <p className="text-ds-14 text-muted-foreground">Buyers can offer one of their listings instead of cash. You choose yes or no on each offer.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={answer.isPending} onClick={() => answer.mutate(false)}>Not now</Button>
        <Button type="button" size="sm" className="rounded-full" disabled={answer.isPending} onClick={() => answer.mutate(true)}>Turn on</Button>
      </div>
    </section>
  );
}
