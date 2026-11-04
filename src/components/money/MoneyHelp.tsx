/**
 * Q2471 (4) (owner 2026-10-29): plain-words "How does this work?" help on the money screen, answered by Claude from
 * our own rules only. It asks support-ai-answer's "ask" mode (the /support helper): the model answers only from the
 * Help Center, has no tools, sees no account data, and an answer that promises a refund, payout or other action is
 * dropped there. Nothing is stored or sent to the team; with no answer, the member is pointed to Support.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { askSupportAiOutcome } from "@/pages/info/SupportAi";

/** The subject the helper sends, so the answer is about money. */
export const MONEY_HELP_SUBJECT = "How does this work? (payments, payouts, fees and refunds)";

export function MoneyHelp() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null | undefined>(undefined);
  const [unreachable, setUnreachable] = useState(false);
  const tooShort = question.trim().length < 10;

  if (!open) {
    return (
      <Button type="button" variant="outline" className="rounded-full" onClick={() => setOpen(true)} data-money-help-open="">
        How does this work?
      </Button>
    );
  }
  return (
    <form
      className="space-y-2 rounded-2xl border border-border p-4"
      aria-label="How does this work?"
      onSubmit={async (e) => {
        e.preventDefault();
        if (tooShort || asking) return;
        setAsking(true);
        const outcome = await askSupportAiOutcome(MONEY_HELP_SUBJECT, question.trim());
        setUnreachable(outcome.unreachable);
        setAnswer(outcome.answer);
        setAsking(false);
      }}
    >
      <label htmlFor="money-help-question" className="text-sm font-medium">Ask how payments, payouts, fees or refunds work</label>
      <Textarea
        id="money-help-question"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="For example: when do I get paid after a job?"
        maxLength={500}
      />
      <Button type="submit" size="sm" className="rounded-full" disabled={tooShort || asking}>
        {asking ? "Asking…" : "Ask"}
      </Button>
      {answer && (
        <div role="status" className="space-y-1" data-money-help-answer="">
          <p className="text-sm whitespace-pre-wrap">{answer}</p>
          <p className="text-xs text-muted-foreground">Written by our AI assistant from our Help Center. It can&apos;t see your account or change anything.</p>
        </div>
      )}
      {answer === null && unreachable && (
        <p role="status" className="text-sm" data-money-help-unreachable="">
          Couldn&apos;t reach the helper right now. Try again, or <Link to="/support" className="underline">contact Support</Link>.
        </p>
      )}
      {answer === null && !unreachable && (
        <p role="status" className="text-sm" data-money-help-none="">
          We couldn&apos;t find that in our Help Center. <Link to="/support" className="underline">Ask our team</Link>.
        </p>
      )}
    </form>
  );
}
