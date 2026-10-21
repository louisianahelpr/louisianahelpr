/**
 * Board 162: the public questions on one Declutter item (spec v2 §9.32).
 * Buyers ask, the seller answers in public; every question and answer goes
 * through the contact-leak filter on the server (declutter_ask_question /
 * declutter_answer_question). Declutter has NO pre-purchase messaging, so the
 * note points to Make an offer only.
 *
 * Truth calls (board vs live data): the asker is never named ("Asked by a
 * neighbor"); the seller's first name comes from the same public profile read
 * as the seller card, and falls back to "the seller".
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import { answerQuestion, askQuestion, fetchQuestions, fetchSellerCard, type DeclutterQuestion } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";

const DAY_MS = 24 * 60 * 60 * 1000;

/** "today", "yesterday", "3 days ago", then the date. */
export function askedWhen(iso: string, nowMs: number = Date.now()): string {
  const then = new Date(iso);
  const startOf = (ms: number) => new Date(new Date(ms).toDateString()).getTime();
  const days = Math.round((startOf(nowMs) - startOf(then.getTime())) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** The seller's first name for "— Marie" / "waiting for Marie"; null when the profile has none. */
function useSellerFirstName(sellerId: string): string | null {
  // Same key as DeclutterSellerCard: one read for both.
  const card = useQuery({ queryKey: ["declutter", "seller-card", sellerId], queryFn: () => fetchSellerCard(sellerId) });
  const first = (card.data?.name ?? "").trim().split(/\s+/)[0];
  return first || null;
}

const field =
  "w-full min-w-0 rounded-2xl border border-input bg-card px-4 py-3 text-ds-15 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function QuestionCard({
  q,
  sellerName,
  onAnswer,
}: {
  q: DeclutterQuestion;
  sellerName: string | null;
  onAnswer: (() => void) | null;
}) {
  const asked = askedWhen(q.created_at);
  return (
    <li className="rounded-2xl border border-border bg-card px-4 py-3 space-y-1" data-question="">
      <p className="text-ds-15 font-semibold [overflow-wrap:anywhere]">{q.question}</p>
      {q.answer ? (
        <>
          <p className="text-ds-13 text-muted-foreground">Asked by a neighbor · {asked}</p>
          <p className="mt-1 border-l-2 border-[hsl(var(--primary)/0.4)] pl-3 text-ds-15 [overflow-wrap:anywhere]" data-answer="">
            {q.answer}
            {sellerName ? <span className="text-muted-foreground"> — {sellerName}</span> : null}
          </p>
        </>
      ) : (
        <p className="text-ds-13 text-muted-foreground">
          Asked {asked} · {onAnswer ? "waiting for your answer" : `waiting for ${sellerName ?? "the seller"}`}
        </p>
      )}
      {!q.answer && onAnswer && (
        <Button type="button" size="sm" className="mt-2" onClick={onAnswer}>
          Answer
        </Button>
      )}
    </li>
  );
}

function AnswerSheet({ q, itemId, onClose }: { q: DeclutterQuestion | null; itemId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [answer, setAnswer] = useState("");
  const send = useMutation({
    mutationFn: (args: { id: string; text: string }) => answerQuestion(args.id, args.text),
    onSuccess: () => {
      setAnswer("");
      toast.success("Answer posted.");
      void qc.invalidateQueries({ queryKey: ["declutter", "questions", itemId] });
      onClose();
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const text = answer.trim();
  return (
    <Sheet
      open={!!q}
      onOpenChange={(o) => {
        if (!o) {
          setAnswer("");
          onClose();
        }
      }}
    >
      <SheetContent side="bottom" floor className="max-h-[90dvh] overflow-y-auto" data-answer-sheet="">
        <SheetHero title="Answer publicly" />
        {q && (
          <div className="space-y-2">
            <p className="text-ds-15 font-semibold [overflow-wrap:anywhere]">"{q.question}"</p>
            <label htmlFor="declutter-answer" className="block pt-2 text-ds-15 font-semibold">Your answer</label>
            <textarea
              id="declutter-answer"
              className={field}
              rows={3}
              maxLength={1000}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
            <p className="text-ds-13 text-muted-foreground">Everyone viewing the item sees this.</p>
          </div>
        )}
        <SheetFooter>
          <SheetPrimaryAction disabled={!q || !text || send.isPending} onClick={() => q && send.mutate({ id: q.id, text })}>
            Post answer
          </SheetPrimaryAction>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function DeclutterQuestions({
  itemId,
  sellerId,
  isSeller,
  canAsk,
}: {
  itemId: string;
  sellerId: string;
  isSeller: boolean;
  /** A signed-in buyer on a live or reserved item. */
  canAsk: boolean;
}) {
  const qc = useQueryClient();
  const sellerName = useSellerFirstName(sellerId);
  const [question, setQuestion] = useState("");
  const [answering, setAnswering] = useState<DeclutterQuestion | null>(null);
  const questions = useQuery({ queryKey: ["declutter", "questions", itemId], queryFn: () => fetchQuestions(itemId) });
  const ask = useMutation({
    mutationFn: (text: string) => askQuestion(itemId, text),
    onSuccess: () => {
      setQuestion("");
      toast.success("Question posted. The answer will show here.");
      void qc.invalidateQueries({ queryKey: ["declutter", "questions", itemId] });
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  const list = questions.data ?? [];
  const text = question.trim();

  return (
    <section className="space-y-3" aria-labelledby="declutter-questions">
      <h2 id="declutter-questions" className="text-ds-13 font-semibold uppercase tracking-wider text-muted-foreground">
        Questions{list.length > 0 ? ` · ${list.length}` : ""}
      </h2>
      {questions.isError ? (
        <ErrorState variant="inline" title="We couldn't load the questions." body={declutterErrorMessage(questions.error)} onRetry={() => void questions.refetch()} />
      ) : questions.isLoading ? null : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No questions yet.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((q) => (
            <QuestionCard key={q.id} q={q} sellerName={sellerName} onAnswer={isSeller ? () => setAnswering(q) : null} />
          ))}
        </ul>
      )}
      {canAsk && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.length >= 2) ask.mutate(text);
          }}
        >
          <label htmlFor="declutter-question" className="block text-ds-15 font-semibold">Ask a question</label>
          <div className="flex gap-2">
            <input
              id="declutter-question"
              className={field}
              value={question}
              maxLength={500}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask the seller"
            />
            <Button type="submit" className="h-auto shrink-0" disabled={ask.isPending || text.length < 2}>
              Ask
            </Button>
          </div>
          <p className="text-ds-13 text-muted-foreground">Everyone can see questions and answers. Contact info is hidden. Want to make a deal? Make an offer.</p>
        </form>
      )}
      {isSeller && <AnswerSheet q={answering} itemId={itemId} onClose={() => setAnswering(null)} />}
    </section>
  );
}
