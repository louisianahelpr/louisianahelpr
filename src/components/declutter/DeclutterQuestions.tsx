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
import { lazy, Suspense, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuthReady } from "@/hooks/useAuthReady";
import { ErrorState } from "@/components/ui/ErrorState";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction } from "@/components/ui/sheet";
import { answerQuestion, askQuestion, fetchMyQuestionIds, fetchQuestions, fetchSellerCard, type DeclutterQuestion } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { DeclutterSuggestedReply } from "./DeclutterSuggestedReply";

const ReportDialog = lazy(() => import("@/components/ReportDialog"));

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
  mine,
  canReport,
  isSeller,
}: {
  q: DeclutterQuestion;
  sellerName: string | null;
  onAnswer: (() => void) | null;
  /** AUD31-15: the viewer asked it (declutter_my_question_ids); only the asker is ever told. */
  mine: boolean;
  /** B48 (owner decision 10-31, App Store 1.2): a signed-in member reports a question or an answer, never their own. */
  canReport: boolean;
  /** The viewer sells this item, so the answer is their own words. */
  isSeller: boolean;
}) {
  const asked = askedWhen(q.created_at);
  const [reporting, setReporting] = useState<"declutter_question" | "declutter_answer" | null>(null);
  const reportLink = (type: "declutter_question" | "declutter_answer", label: string) => (
    <button type="button" className="min-h-11 pr-4 text-ds-13 text-muted-foreground" onClick={() => setReporting(type)} data-report={type}>
      {label}
    </button>
  );
  return (
    <li className="rounded-2xl border border-border bg-card px-4 py-3 space-y-1" data-question="" data-mine={mine ? "" : undefined}>
      <p className="text-ds-15 font-semibold [overflow-wrap:anywhere]">{q.question}</p>
      {q.answer ? (
        <>
          <p className="text-ds-13 text-muted-foreground">{mine ? "Your question" : "Asked by a neighbor"} · {asked}</p>
          <p className="mt-1 border-l-2 border-[hsl(var(--primary)/0.4)] pl-3 text-ds-15 [overflow-wrap:anywhere]" data-answer="">
            {q.answer}
            {sellerName ? <span className="text-muted-foreground"> — {sellerName}</span> : null}
          </p>
        </>
      ) : (
        <p className="text-ds-13 text-muted-foreground">
          {mine ? "Your question · asked" : "Asked"} {asked} · {onAnswer ? "waiting for your answer" : `waiting for ${sellerName ?? "the seller"}`}
        </p>
      )}
      {!q.answer && onAnswer && (
        <Button type="button" size="sm" className="mt-2" onClick={onAnswer}>
          Answer
        </Button>
      )}
      {canReport && (!mine || (q.answer && !isSeller)) && (
        <div className="flex flex-wrap">
          {!mine && reportLink("declutter_question", "Report question")}
          {q.answer && !isSeller && reportLink("declutter_answer", "Report answer")}
        </div>
      )}
      {reporting && (
        <Suspense fallback={null}>
          <ReportDialog open onClose={() => setReporting(null)} reportedType={reporting} reportedId={q.id} />
        </Suspense>
      )}
    </li>
  );
}

function AnswerSheet({ q, itemId, onClose }: { q: DeclutterQuestion | null; itemId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [answer, setAnswer] = useState("");
  // AUD31-30: a refused answer is said under the box (the draft stays), as Ask does, never a toast over the box.
  const [refusal, setRefusal] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: (args: { id: string; text: string }) => answerQuestion(args.id, args.text),
    onSuccess: () => {
      setAnswer("");
      setRefusal(null);
      toast("Answer posted.");
      void qc.invalidateQueries({ queryKey: ["declutter", "questions", itemId] });
      onClose();
    },
    onError: (err) => setRefusal(declutterErrorMessage(err)),
  });
  const text = answer.trim();
  return (
    <Sheet
      open={!!q}
      onOpenChange={(o) => {
        if (!o) {
          setAnswer("");
          setRefusal(null);
          onClose();
        }
      }}
    >
      <SheetContent side="bottom" floor className="max-h-[90dvh] overflow-y-auto" data-answer-sheet="">
        <SheetHero title="Answer publicly" />
        {q && (
          <div className="space-y-2">
            <p className="text-ds-15 font-semibold [overflow-wrap:anywhere]">"{q.question}"</p>
            {/* Owner 2026-10-29: Claude's suggested reply; Send posts it, Edit fills the box. Never sent on its own. */}
            {!answer && (
              <DeclutterSuggestedReply
                questionId={q.id}
                sending={send.isPending}
                onSend={(t) => send.mutate({ id: q.id, text: t })}
                onEdit={(t) => {
                  setAnswer(t);
                  requestAnimationFrame(() => document.getElementById("declutter-answer")?.focus());
                }}
              />
            )}
            <label htmlFor="declutter-answer" className="block pt-2 text-ds-15 font-semibold">Your answer</label>
            <textarea
              id="declutter-answer"
              className={field}
              rows={3}
              maxLength={1000}
              value={answer}
              onChange={(e) => { setAnswer(e.target.value); setRefusal(null); }}
              aria-invalid={refusal ? true : undefined}
              aria-describedby={refusal ? "declutter-answer-error" : undefined}
            />
            {refusal && <p id="declutter-answer-error" role="alert" className="text-ds-13 text-destructive-ink">{refusal}</p>}
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
  free = false,
  preview = false,
  onMakeOffer,
}: {
  itemId: string;
  sellerId: string;
  isSeller: boolean;
  /** A signed-in buyer on a live or reserved item. */
  canAsk: boolean;
  /** A free item is claimed, never offered on (deep audit #23): no "Make an offer" line. */
  free?: boolean;
  /** The seller's "See what buyers see" (LEAD-PREVIEW-ASK): the Ask box shows, greyed out, saying how it works. */
  preview?: boolean;
  /** AUD31-15: opens the offer box on the item page; without it the hint stays plain words. */
  onMakeOffer?: () => void;
}) {
  const qc = useQueryClient();
  const sellerName = useSellerFirstName(sellerId);
  const [question, setQuestion] = useState("");
  const [answering, setAnswering] = useState<DeclutterQuestion | null>(null);
  const questions = useQuery({ queryKey: ["declutter", "questions", itemId], queryFn: () => fetchQuestions(itemId) });
  // AUD31-15: the viewer's own questions say "Your question". Same key prefix, so asking one refreshes it too. The
  // seller never asks on their own listing and a guest asks nothing, so neither reads it; a failed read only leaves the
  // label off.
  const { user } = useAuthReady();
  const myIds = useQuery({ queryKey: ["declutter", "questions", itemId, "mine"], queryFn: () => fetchMyQuestionIds(itemId), enabled: !!user && !isSeller });
  // Audit 1028 part 2, D2-13: a refusal (a phone number or email in the question, say) shows under the box, not in a
  // toast that sat on top of the box and the Ask button for 20+ seconds at 375. Typing again clears it.
  const ask = useMutation({
    mutationFn: (text: string) => askQuestion(itemId, text),
    onSuccess: () => {
      setQuestion("");
      toast("Question posted. The answer will show here.");
      void qc.invalidateQueries({ queryKey: ["declutter", "questions", itemId] });
    },
  });
  const askError = ask.isError ? declutterErrorMessage(ask.error) : null;
  const list = questions.data ?? [];
  // AUD31-28: Selling's "Questions to answer" links here with #declutter-questions; once the questions are in, the
  // page scrolls to them (the item page opened at its top, the question ~2 screens down at 375).
  const loaded = questions.isSuccess;
  useEffect(() => {
    if (loaded && window.location.hash === "#declutter-questions") {
      document.getElementById("declutter-questions")?.scrollIntoView({ block: "start" });
    }
  }, [loaded]);
  const text = question.trim();

  return (
    <section className="space-y-3" aria-labelledby="declutter-questions">
      <h2 id="declutter-questions" className="text-base font-semibold">
        {/* Owner mockup 11-01: "Questions (N)", the count always. */}
        Questions ({questions.isLoading ? 0 : list.length})
      </h2>
      {questions.isError ? (
        <ErrorState variant="inline" title="We couldn't load the questions." body={declutterErrorMessage(questions.error)} onRetry={() => void questions.refetch()} />
      ) : questions.isLoading ? null : list.length === 0 ? (
        // Owner mockup 11-01: the one-line box says it already; "No questions yet" only where nobody can ask here.
        canAsk ? null : <p className="text-sm text-muted-foreground">No questions yet.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((q) => (
            <QuestionCard key={q.id} q={q} sellerName={sellerName} onAnswer={isSeller ? () => setAnswering(q) : null} mine={!!myIds.data?.has(q.id)} canReport={!!user} isSeller={isSeller} />
          ))}
        </ul>
      )}
      {canAsk && (
        <form
          className="space-y-2 pb-[var(--bottom-nav-h,0px)] [&_*]:scroll-mb-[calc(var(--bottom-nav-h,0px)+1rem)]"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.length >= 2) ask.mutate(text);
          }}
        >
          <label htmlFor="declutter-question" className="sr-only">Ask a question</label>
          <div className="flex gap-2">
            <input
              id="declutter-question"
              className={field}
              value={question}
              maxLength={500}
              onChange={(e) => { setQuestion(e.target.value); if (ask.isError) ask.reset(); }}
              placeholder="Ask about size, condition…"
              aria-invalid={askError ? true : undefined}
              aria-describedby={askError ? "declutter-question-error" : undefined}
            />
            {/* Outline: Buy now is the item page's one filled button (Declutter audit 2026-10-28: two olive buttons, Buy now
                and Ask, competed). Guard: declutterItemPage.test.tsx "one filled button". */}
            <Button type="submit" variant="outline" className="h-auto shrink-0" disabled={ask.isPending || text.length < 2}>
              Ask
            </Button>
          </div>
          {askError && <p id="declutter-question-error" role="alert" className="text-ds-13 text-destructive-ink">{askError}</p>}
          {/* AUD31-15: "Make an offer" opens the offer box on this page (DeclutterItemView's onMakeOffer), not plain text. */}
          <p className="text-ds-13 text-muted-foreground">Everyone can see questions and answers. Contact info is not allowed.{free ? null : onMakeOffer
            ? <>{" Want to make a deal? "}<button type="button" className="font-semibold text-foreground underline underline-offset-2" onClick={onMakeOffer} data-question-make-offer="">Make an offer</button>.</>
            : " Want to make a deal? Make an offer."}</p>
        </form>
      )}
      {preview && (
        // LEAD-PREVIEW-ASK (owner 2026-10-31): the seller sees where buyers ask, but can't ask on their own listing.
        <div className="space-y-2" aria-disabled="true" data-preview-ask="">
          <label htmlFor="declutter-question-preview" className="block text-ds-15 font-semibold text-muted-foreground">Ask a question</label>
          <div className="flex gap-2">
            <input id="declutter-question-preview" className={`${field} bg-muted`} disabled placeholder="Ask about size, condition…" aria-describedby="declutter-question-preview-note" />
            <Button type="button" variant="outline" className="h-auto shrink-0" disabled>
              Ask
            </Button>
          </div>
          <p id="declutter-question-preview-note" className="text-ds-13 text-muted-foreground">
            Buyers ask here. You'll get a notice and answer from this page.
          </p>
        </div>
      )}
      {isSeller && <AnswerSheet q={answering} itemId={itemId} onClose={() => setAnswering(null)} />}
    </section>
  );
}
