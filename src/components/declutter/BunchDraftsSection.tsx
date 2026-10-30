/**
 * Sell a bunch: "List all my drafts" (audit finding 1). A seller whose items were saved as drafts (the setup fee was
 * due, a phone locked mid-run) had to open each one. This lists them together through publishMany, the same three calls
 * as one listing, after the same four confirmations; each refusal is named. While the setup fee is due only the free
 * drafts are offered (the server asks no fee at price 0); a priced one would be refused, and its refusal would stop the
 * rest (publishMany), so those wait. Drafts still on the Check-each-item list stay with that list (exclude).
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { publishMany, type PublishOutcome } from "@/lib/declutter/moves";
import { myItemsQuery } from "./myItemsQuery";
import { TaxStatementsCheck } from "./declutterUi";

export function BunchDraftsSection({ userId, exclude, busy, feeDue, onBusy }: { userId: string; exclude: ReadonlySet<string>; busy: boolean; feeDue: boolean; onBusy: (on: boolean) => void }) {
  const qc = useQueryClient();
  const mine = useQuery(myItemsQuery(userId));
  const [attested, setAttested] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [results, setResults] = useState<{ title: string; outcome: PublishOutcome }[] | null>(null);
  const saved = (mine.data ?? []).filter((i) => i.status === "draft" && !exclude.has(i.id));
  const drafts = feeDue ? saved.filter((i) => i.current_price_cents === 0) : saved;
  const waiting = saved.length - drafts.length;

  async function listAll() {
    setProblem(null);
    if (!attested) {
      setProblem("Tick the box under the four statements before you list your drafts.");
      return;
    }
    const titles = new Map(drafts.map((d) => [d.id, d.title]));
    onBusy(true);
    setProgress({ done: 0, total: drafts.length });
    try {
      const out = await publishMany(drafts.map((d) => d.id), (done, total) => setProgress({ done, total }));
      setResults(out.map((outcome) => ({ title: titles.get(outcome.id) ?? "An item", outcome })));
    } catch (err) {
      // Not silent: publishMany returns each refusal, so this is a fault around it; shown beside the button.
      setProblem(declutterErrorMessage(err));
    } finally {
      setProgress(null);
      onBusy(false);
      void qc.invalidateQueries({ queryKey: ["declutter"] });
    }
  }

  const failed = (results ?? []).filter((r) => "error" in r.outcome);
  const listed = (results?.length ?? 0) - failed.length;
  if (drafts.length === 0 && !results) return null;

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-labelledby="bunch-drafts" data-bunch-drafts="">
      <h2 id="bunch-drafts" className="text-base font-semibold">Your saved drafts</h2>
      {drafts.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            You have {drafts.length} unfinished {feeDue ? "free " : ""}{drafts.length === 1 ? "listing" : "listings"}. List them together, or finish each one under Selling. One tick counts for every draft you list now.
            {waiting > 0 && ` ${waiting} priced ${waiting === 1 ? "draft waits" : "drafts wait"} for the setup fee.`}
          </p>
          <TaxStatementsCheck id="bunch-drafts-tax" checked={attested} onChange={setAttested} />
          {problem && <p className="text-sm text-destructive-ink" role="alert">{problem}</p>}
          <Button type="button" className="rounded-full" disabled={busy} onClick={() => void listAll()}>
            {progress ? `Listing… (${progress.done} of ${progress.total})` : feeDue ? "List my free drafts" : "List all my drafts"}
          </Button>
        </>
      )}
      {results && (
        <div className="space-y-1 text-sm" data-bunch-drafts-done="">
          {listed > 0 && <p>{listed} listed.</p>}
          {failed.map((f, i) => (
            <p key={i}><span className="font-semibold">{f.title}</span> wasn't listed: {declutterErrorMessage((f.outcome as { error: unknown }).error)}</p>
          ))}
        </div>
      )}
    </section>
  );
}
