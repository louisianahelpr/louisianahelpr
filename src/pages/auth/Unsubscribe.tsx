import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Mail, MailX, MailCheck, MailQuestionMark } from "lucide-react";
import { Button } from "@/components/ui/button";
import AuthShell from "@/components/auth/AuthShell";
import { usePageMeta } from "@/hooks/usePageMeta";
import { NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";
import {
  addressFromLink,
  parseUnsubscribeLink,
  sendUnsubscribeChoice,
  type UnsubscribeLink,
  type UnsubscribeOutcome,
} from "@/lib/emailUnsubscribe";

/**
 * Q1655: where an email's "Unsubscribe" link lands. The link used to switch
 * the email off on the GET itself, so any mail scanner or link preview that
 * fetched it turned a member's email off without them. Now the edge function
 * writes nothing on a GET and sends the reader here, signed out or in; one
 * button makes the change, and the result offers the way back.
 */

const COPY = {
  job_matches: {
    ask: "Turn off new-job emails?",
    askBody: (who: string) =>
      `We'll stop emailing ${who} each time a new job is posted. New jobs still show in the app, and you'll still get email about your own jobs, messages and payments.`,
    confirm: "Turn Off New-Job Emails",
    done: "New-job emails are off",
    doneBody: (who: string) => `We won't email ${who} about new jobs any more.`,
    undo: "Turn New-Job Emails Back On",
    back: "New-job emails are back on",
    backBody: (who: string) => `${who} will get an email again whenever a new job is posted.`,
  },
  promotions: {
    ask: "Unsubscribe from promotional email?",
    askBody: (who: string) =>
      `We'll stop sending Louisiana Helpr news and offers to ${who}. You'll still get email about your account: job updates, payments and payouts, and security notices.`,
    confirm: "Unsubscribe",
    done: "You're unsubscribed",
    doneBody: (who: string) => `We won't send promotional email to ${who} any more.`,
    undo: "Resubscribe",
    back: "You're subscribed again",
    backBody: (who: string) => `${who} will get Louisiana Helpr news and offers again.`,
  },
} as const;

const FAILURE: Record<Exclude<UnsubscribeOutcome, { ok: true }>["reason"], string> = {
  invalid_link: "This link isn't valid. It may have been changed, or it's from an older email.",
  unavailable: "We can't change email settings right now. Please try again in a few minutes.",
  failed: "That may not have saved. Please try again.",
  network: "We couldn't reach Louisiana Helpr, so that may not have saved. Check your connection and try again.",
};

type Stage = "ask" | "unsubscribed" | "resubscribed";

const muted = { color: "hsl(var(--olivewood) / 0.8)" };

const Unsubscribe = () => {
  usePageMeta(NOINDEX_PAGE_META["/unsubscribe"]);
  const { search } = useLocation();
  // Read ONCE, then dropped from the address bar: the signed link is a
  // credential that can change consent, and a page URL is what analytics
  // pageviews and error reports record (lh-authz-rls review of Q1655, #1;
  // the same as ResetPassword's spent token).
  const [link] = useState<UnsubscribeLink | null>(() => parseUnsubscribeLink(search));
  useEffect(() => {
    if (window.location.search) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);
  const who = (link && addressFromLink(link.e)) || "this address";
  const [stage, setStage] = useState<Stage>("ask");
  const [busy, setBusy] = useState(false);
  // A missing link is said once, by the heading and its line below; `problem`
  // is only ever a failed SEND (seen at 375: the heading and a red line
  // repeated the same sentence).
  const [problem, setProblem] = useState<string | null>(null);

  const copy = COPY[link?.list ?? "promotions"];

  const choose = async (action: "unsubscribe" | "resubscribe") => {
    if (!link || busy) return;
    setBusy(true);
    setProblem(null);
    const outcome = await sendUnsubscribeChoice(import.meta.env.VITE_SUPABASE_URL ?? "", link, action);
    setBusy(false);
    if (outcome.ok) setStage(outcome.status);
    else setProblem(FAILURE[outcome.reason]);
  };

  const heading = stage === "ask" ? copy.ask : stage === "unsubscribed" ? copy.done : copy.back;
  const body = stage === "ask" ? copy.askBody(who) : stage === "unsubscribed" ? copy.doneBody(who) : copy.backBody(who);
  // The icon says the state: a plain envelope while asking (a check mark
  // there read as "already done"), a crossed one once off, a checked one once
  // back on, a question for a link that isn't valid.
  const Icon = !link ? MailQuestionMark : stage === "ask" ? Mail : stage === "unsubscribed" ? MailX : MailCheck;

  return (
    <AuthShell hideBack hideHeader centerColumn maxWidth="md">
      <div className="liquid-glass p-7 sm:p-8 space-y-6 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
          style={{ background: "hsl(var(--sage) / 0.14)" }}
          aria-hidden="true"
        >
          <Icon className="w-8 h-8" style={{ color: "hsl(var(--sage-ink))" }} strokeWidth={1.5} />
        </div>

        <div className="space-y-2">
          <h1 className="text-page-title leading-tight text-balance">{link ? heading : "This link isn't valid"}</h1>
          <p className="font-sans text-ds-13 [overflow-wrap:anywhere]" style={muted}>
            {link ? body : "It may have been changed, or it's from an older email."}
          </p>
        </div>

        {problem && (
          <p role="alert" className="font-sans text-ds-13" style={{ color: "hsl(var(--burnt-sienna))" }}>
            {problem}
          </p>
        )}

        {link && (
          <div className="space-y-3">
            {stage === "ask" && (
              <Button variant="primary" type="button" size="lg" className="w-full rounded-ds-md" disabled={busy} onClick={() => choose("unsubscribe")}>
                {busy ? "Saving…" : copy.confirm}
              </Button>
            )}
            {stage === "unsubscribed" && (
              <Button variant="outline" type="button" size="lg" className="w-full rounded-ds-md" disabled={busy} onClick={() => choose("resubscribe")}>
                {busy ? "Saving…" : copy.undo}
              </Button>
            )}
          </div>
        )}

        <p className="font-sans text-ds-11" style={muted}>
          Manage every kind of email under Notifications in your{" "}
          <Link to="/profile?tab=notifications" className="underline underline-offset-2">
            profile
          </Link>
          .
        </p>
      </div>
    </AuthShell>
  );
};

export default Unsubscribe;
