/**
 * SH12: the owner's FAQs on /shops/mine (migration 20261019072541). Saves on
 * its own, like the pickup address. Up to 10 questions; the server refuses
 * phone numbers, emails and links (members reach the shop with Message).
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { FAQ_ANSWER_MAX, FAQ_MAX, FAQ_QUESTION_MAX, fetchShopFaqs, saveMyShopFaqs, type ShopFaq } from "@/lib/shops/faqs";
import { shopsErrorMessage } from "@/lib/shops/errors";

export default function ShopFaqsEditor({ shopId }: { shopId: string }) {
  const qc = useQueryClient();
  const key = ["shops", "faqs", shopId];
  const current = useQuery({ queryKey: key, queryFn: () => fetchShopFaqs(shopId) });
  const [rows, setRows] = useState<ShopFaq[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded || !current.data) return;
    setRows(current.data);
    setLoaded(true);
  }, [current.data, loaded]);

  const save = useMutation({
    mutationFn: () => saveMyShopFaqs(rows),
    onSuccess: (n) => {
      toast.success(n === 0 ? "Questions removed." : "Questions saved.");
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  const setRow = (i: number, patch: Partial<ShopFaq>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-labelledby="shop-faqs-heading" data-testid="shop-faqs-editor">
      <div className="space-y-1">
        <h2 id="shop-faqs-heading" className="text-base font-semibold">Questions buyers ask</h2>
        <p className="text-sm text-muted-foreground">Answer them once, on your shop page. No phone numbers, emails or links: buyers message you in the app.</p>
      </div>
      {current.isError && !current.data ? (
        <ErrorState variant="inline" title="We couldn't load your questions." body={shopsErrorMessage(current.error)} onRetry={() => void current.refetch()} />
      ) : !loaded ? (
        <div className="space-y-2" role="status" aria-label="Loading your questions">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : (
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No questions yet.</p>}
          {rows.map((row, i) => (
            <fieldset key={i} className="space-y-2 rounded-xl border border-border p-3">
              <legend className="sr-only">Question {i + 1}</legend>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`faq-q-${i}`}>Question {i + 1}</Label>
                  <Button type="button" variant="ghost" size="sm" aria-label={`Remove question ${i + 1}`} onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
                <Input id={`faq-q-${i}`} value={row.question} maxLength={FAQ_QUESTION_MAX} placeholder="Do you deliver?" onChange={(e) => setRow(i, { question: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`faq-a-${i}`}>Answer</Label>
                <Textarea id={`faq-a-${i}`} value={row.answer} maxLength={FAQ_ANSWER_MAX} rows={3} onChange={(e) => setRow(i, { answer: e.target.value })} />
              </div>
            </fieldset>
          ))}
          {rows.length < FAQ_MAX && (
            <Button type="button" variant="outline" size="sm" onClick={() => setRows((r) => [...r, { question: "", answer: "" }])}>
              <Plus className="h-4 w-4" aria-hidden /> Add a question
            </Button>
          )}
          <Button type="submit" className="w-full" variant="outline" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save questions"}
          </Button>
        </form>
      )}
    </section>
  );
}
