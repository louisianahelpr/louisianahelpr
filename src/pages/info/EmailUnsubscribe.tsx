import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MailX, MailCheck, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import AuthShell from "@/components/auth/AuthShell";
import { usePageMeta } from "@/hooks/usePageMeta";
import { NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";
import {
  postUnsubscribe,
  readUnsubscribeLink,
  type UnsubscribeLink,
  type UnsubscribeList,
  type UnsubscribeResult,
} from "@/lib/emailUnsubscribe";

/**
 * /unsubscribe: where every email footer's unsubscribe link lands (Q1655,
 * Q?unsub-page-raw-html). The edge function's GET writes nothing and sends the
 * visitor here; nothing changes until they tap the button. See
 * src/lib/emailUnsubscribe.ts for the whole path.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

/**
 * Read the signed link ONCE, then take it out of the address bar: the token
 * carries the email address, and analytics records page URLs. It stays in
 * history.state so a reload of this tab still works.
 */
function takeLinkFromUrl(): UnsubscribeLink | null {
  if (typeof window === "undefined") return null;
  const fromUrl = readUnsubscribeLink(window.location.hash);
  const state = (window.history.state ?? {}) as { unsubscribeLink?: UnsubscribeLink };
  const link = fromUrl ?? state.unsubscribeLink ?? null;
  if (fromUrl) {
    try {
      window.history.replaceState({ ...state, unsubscribeLink: fromUrl }, "", window.location.pathname);
    } catch {
      // Some embedded browsers refuse replaceState; the page still works.
    }
  }
  return link;
}

type View =
  | { kind: "checking" }
  | { kind: "missing" }
  | { kind: "confirm"; email: string; list: UnsubscribeList; busy: boolean; error?: Failure }
  | { kind: "done"; email: string; list: UnsubscribeList; resubscribed: boolean; busy: boolean; error?: Failure }
  | { kind: "error"; error: Failure };

type Failure = Extract<UnsubscribeResult, { ok: false }>["error"];

const COPY = {
  promotions: {
    ask: "Stop news and offers?",
    askBody: (email: string) => `We'll stop sending Louisiana Helpr news and offers to ${email}.`,
    button: "Unsubscribe",
    off: "You're unsubscribed",
    offBody: (email: string) => `We won't send news or offers to ${email} any more.`,
    undo: "Resubscribe",
    on: "You're subscribed again",
    onBody: (email: string) => `${email} will get Louisiana Helpr news and offers again.`,
  },
  job_matches: {
    ask: "Stop new-job emails?",
    askBody: (email: string) => `We'll stop emailing ${email} each time a new job is posted. New jobs still show in the app.`,
    button: "Turn off new-job emails",
    off: "New-job emails are off",
    offBody: (email: string) => `We won't email ${email} about new jobs any more. New jobs still show in the app.`,
    undo: "Turn them back on",
    on: "New-job emails are back on",
    onBody: (email: string) => `${email} will get an email again whenever a new job is posted.`,
  },
} as const;

const KEEPS = "You'll still get email about your own jobs, messages and payments.";

function failureText(error: Failure): string {
  switch (error) {
    case "invalid_link":
      return "This link may be cut off or from an old email. You can turn emails off yourself under Notifications in your profile, or contact support and we'll do it for you.";
    case "unavailable":
      return "Unsubscribing isn't working right now. Contact support and we'll take you off the list by hand.";
    case "network":
      return "We couldn't reach Louisiana Helpr. Check your connection and try again.";
    default:
      return "We couldn't save that. Please try again in a minute, or contact support.";
  }
}

const EmailUnsubscribe = () => {
  usePageMeta(NOINDEX_PAGE_META["/unsubscribe"]);
  const [link, setLink] = useState<UnsubscribeLink | null>(takeLinkFromUrl);
  const [view, setView] = useState<View>(() => (link ? { kind: "checking" } : { kind: "missing" }));

  // A second email's link opened in a tab already on this page changes only
  // the fragment, which re-renders nothing by itself: read the new link.
  useEffect(() => {
    const onHash = () => {
      const next = readUnsubscribeLink(window.location.hash) ? takeLinkFromUrl() : null;
      if (next) setLink(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Step 1: verify the link and learn whose it is. Writes nothing.
  useEffect(() => {
    if (!link) return;
    setView({ kind: "checking" });
    let live = true;
    void postUnsubscribe(SUPABASE_URL, link, "check").then((r) => {
      if (!live) return;
      setView(r.ok ? { kind: "confirm", email: r.email, list: r.list, busy: false } : { kind: "error", error: r.error });
    });
    return () => {
      live = false;
    };
  }, [link]);

  const run = useCallback(
    async (action: "unsubscribe" | "resubscribe") => {
      if (!link) return;
      setView((v) => (v.kind === "confirm" || v.kind === "done" ? { ...v, busy: true, error: undefined } : v));
      const r = await postUnsubscribe(SUPABASE_URL, link, action);
      setView((v) => {
        if (v.kind !== "confirm" && v.kind !== "done") return v;
        if (!r.ok) return { ...v, busy: false, error: r.error };
        return { kind: "done", email: r.email, list: r.list, resubscribed: action === "resubscribe", busy: false };
      });
    },
    [link],
  );

  let icon = <MailX className="w-8 h-8" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={1.5} />;
  let title: string;
  let body: string;
  let extra: string | null = null;
  let action: { label: string; busyLabel: string; onClick: () => void; busy: boolean; variant: "primary" | "outline" } | null = null;
  let error: Failure | undefined;
  let showHelp = false;

  if (view.kind === "checking") {
    title = "Checking your link";
    body = "One moment.";
  } else if (view.kind === "missing") {
    icon = <AlertCircle className="w-8 h-8" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={1.5} />;
    title = "Open the link from your email";
    body = "This page works from the unsubscribe link at the bottom of one of our emails. You can also turn emails off under Notifications in your profile.";
    showHelp = true;
  } else if (view.kind === "error") {
    icon = <AlertCircle className="w-8 h-8" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={1.5} />;
    title = view.error === "invalid_link" ? "That link isn't valid" : "Something went wrong";
    body = failureText(view.error);
    showHelp = true;
  } else if (view.kind === "confirm") {
    const c = COPY[view.list];
    title = c.ask;
    body = c.askBody(view.email);
    extra = KEEPS;
    action = { label: c.button, busyLabel: "Saving…", onClick: () => void run("unsubscribe"), busy: view.busy, variant: "primary" };
    error = view.error;
  } else {
    const c = COPY[view.list];
    if (view.resubscribed) {
      icon = <MailCheck className="w-8 h-8" style={{ color: "hsl(var(--olivewood))" }} strokeWidth={1.5} />;
      title = c.on;
      body = c.onBody(view.email);
    } else {
      title = c.off;
      body = c.offBody(view.email);
      extra = KEEPS;
      action = { label: c.undo, busyLabel: "Saving…", onClick: () => void run("resubscribe"), busy: view.busy, variant: "outline" };
    }
    error = view.error;
  }

  return (
    <AuthShell hideBack hideHeader hideFooter centerColumn maxWidth="md">
      <div className="liquid-glass p-7 sm:p-8 space-y-6 text-center" aria-busy={view.kind === "checking"}>
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
          style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
        >
          {icon}
        </div>

        <div className="space-y-2">
          <h1 className="text-page-title leading-tight mt-2 text-balance">{title}</h1>
          <p className="font-sans text-ds-13 [overflow-wrap:anywhere]" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            {body}
          </p>
          {extra && (
            <p className="font-sans text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {extra}
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="font-sans text-ds-13" style={{ color: "hsl(var(--destructive))" }}>
            {failureText(error)}
          </p>
        )}

        {/* The opt-out is the primary; once done, "resubscribe" is an undo
            offered in outline, never pushed as the main thing to do. */}
        {action && (
          <Button variant={action.variant} className="w-full rounded-ds-md" size="lg" onClick={action.onClick} disabled={action.busy}>
            {action.busy ? action.busyLabel : action.label}
          </Button>
        )}

        <div className="flex flex-col gap-2">
          <Button asChild variant="ghost" className="w-full rounded-ds-md" size="sm">
            <Link to="/profile?tab=notifications">Email settings</Link>
          </Button>
          {(showHelp || error) && (
            <Button asChild variant="ghost" className="w-full rounded-ds-md" size="sm">
              <Link to="/support?topic=message&subject=Unsubscribe">Contact support</Link>
            </Button>
          )}
        </div>
      </div>
    </AuthShell>
  );
};

export default EmailUnsubscribe;
