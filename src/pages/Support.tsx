import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BookOpen, CheckCircle2, ChevronRight, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import BackButton from "@/components/BackButton";
import PublicLayout from "@/components/marketing/PublicLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuthReady } from "@/hooks/useAuthReady";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { hapticError } from "@/lib/haptics";
import {
  SUPPORT_TOPICS,
  findSupportTopic,
  type SupportTopicKey,
} from "@/lib/supportTopics";

/**
 * /support — the public contact-support page.
 *
 * This is the ONLY contact surface a logged-OUT visitor has. Legal pages, the
 * Help Center, and the Profile Legal tab's data-rights footnote all say
 * "contact support"; before this page existed those links either bounced to
 * a static FAQ or to a raw `mailto:`
 * (which does nothing at all inside the native app, where no mail client is
 * wired up). /support used to `<Navigate to="/help">` for the same reason —
 * the real form lived behind auth in the Profile tab.
 *
 * Shape notes:
 *   • Renders inside PublicLayout, matching /help and /for-business — the
 *     compact header below carries the canonical BackButton, which is the
 *     page's only back affordance.
 *   • Magazine layout (left masthead / right content) on the standard
 *     `page-measure` container, so the form fills the page at
 *     every breakpoint instead of floating in a narrow column with dead side
 *     gutters. The rail inset is NOT applied here — it comes from the global
 *     `#root` padding rule for document-scroll routes (see CLAUDE.md).
 *   • Field set, copy, and topic list are shared with the in-app support tab
 *     via `src/lib/supportTopics.ts`, so the two surfaces read as one system.
 *
 * Backend: `supabase.functions.invoke("contact-support")`. A guest cannot
 * write to `reports` (RLS + NOT NULL uuid `reporter_id`), so the edge function
 * emails the support inbox instead — and, when the sender IS signed in, also
 * files the same `reports` row the Profile tab writes so both land in one
 * admin queue.
 */

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

// Kept in lockstep with the server-side bounds in
// supabase/functions/contact-support/index.ts. The server is the enforcer;
// these exist so the visitor is told what's wrong BEFORE a round trip.
const NAME_MIN = 2;
const NAME_MAX = 100;
const EMAIL_MAX = 254;
const SUBJECT_MAX = 120;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 5000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type FieldKey = "name" | "email" | "topic" | "message";

// Plain-language names for the "still needed" hint under a disabled submit.
const FIELD_NOUNS: Record<FieldKey, string> = {
  name: "your name",
  email: "your email",
  topic: "a topic",
  message: "a message",
};

interface Draft {
  name: string;
  email: string;
  topic: SupportTopicKey | "";
  subject: string;
  message: string;
}

/**
 * Field-by-field validation. `identified` is true when the sender is signed in
 * — their name and email come from their profile server-side, so the form
 * never asks for them and never validates them.
 */
function validate(draft: Draft, identified: boolean): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};

  if (!identified) {
    const name = draft.name.trim();
    if (!name) errors.name = "Please tell us your name.";
    else if (name.length < NAME_MIN) errors.name = "That name looks too short.";

    const email = draft.email.trim();
    if (!email) errors.email = "We need an email address to reply to.";
    else if (!EMAIL_RE.test(email)) errors.email = "That doesn't look like a valid email address.";
  }

  if (!draft.topic) errors.topic = "Choose what your message is about.";

  const message = draft.message.trim();
  if (!message) errors.message = "Tell us what's going on.";
  else if (message.length < MESSAGE_MIN) {
    errors.message = `Please write at least ${MESSAGE_MIN} characters so we can help.`;
  }

  return errors;
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Compact page header — canonical BackButton to the LEFT of a normal-size page
 * title. Identical row shape to /for-business and /help; /support is a
 * secondary destination reached from a footer/legal link, not a landing.
 */
const PageIntro = () => (
  <section className="container mx-auto px-5">
    <div className="page-measure mx-auto">
      <div className="flex items-center gap-3 mt-4 mb-3 md:mt-5 md:mb-4">
        <div className="shrink-0">
          <BackButton />
        </div>
        <div className="flex flex-col leading-none min-w-0 flex-1">
          <h1 className="text-page-title leading-tight truncate">Contact support</h1>
        </div>
      </div>
    </div>
  </section>
);

/** Shared squircle treatment used by every panel on the public pages. */
const PANEL_STYLE = {
  background: "hsl(var(--burnt-sienna) / 0.04)",
  border: "1.5px solid hsl(var(--burnt-sienna) / 0.15)",
  boxShadow: "var(--elev-inset-hairline)",
} as const;

/** Inline field error — same shape as AddCalendarForm's budget error
 *  (role="alert" + the id the input points at via aria-describedby).
 *  Renders nothing when there's no message, so call sites stay flat. */
const FieldError = ({ id, message }: { id: string; message?: string }) =>
  message ? (
    <p
      id={id}
      role="alert"
      className="mt-1.5 font-sans text-ds-11 leading-snug"
      style={{ color: "hsl(var(--burnt-sienna))" }}
    >
      {message}
    </p>
  ) : null;

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

const Support = () => {
  usePageMeta({
    title: "Contact support — Helpr | Louisiana's Local Job Partner",
    description:
      "Message the Helpr team about your account, a job, a payment, or a bug. No account needed — we reply by email.",
    canonical: "https://www.louisianahelpr.com/support",
    ogTitle: "Contact support — Helpr",
    ogDescription:
      "Message the Helpr team about your account, a job, a payment, or a bug. No account needed — we reply by email.",
  });

  const { user, isReady } = useAuthReady();
  const { data: profile, isLoading: profileLoading } = useProfile(user?.id);

  // `?topic=` / `?subject=` let a linking screen open the form pre-aimed
  // (e.g. the suspended-account page arrives with subject="Account suspension
  // appeal"). Deliberately NOT `?message=` or any personal detail — a URL is
  // the wrong place for that, it leaks into history and referrers. Anything
  // identifying is read server-side from the session instead.
  const [searchParams] = useSearchParams();
  const initialTopic = findSupportTopic(searchParams.get("topic"))?.key ?? "";
  const initialSubject = (searchParams.get("subject") ?? "").slice(0, SUBJECT_MAX);

  const [draft, setDraft] = useState<Draft>({
    name: "",
    email: "",
    topic: initialTopic,
    subject: initialSubject,
    message: "",
  });
  // Errors only appear once a field has been blurred (or submit attempted), so
  // the form doesn't shout at someone who has simply not typed yet.
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // A signed-in visitor is never asked to retype their own name and email —
  // the edge function reads both from their profile, which is also the copy we
  // can actually trust. `isReady` gates this so a logged-in user never sees a
  // flash of the guest name/email fields during the auth bootstrap.
  //
  // A profile can legitimately be missing either field (partial onboarding),
  // and the server rejects a message with no name or email. Rather than hand
  // that visitor a 400 with no field to fix, fall back to ASKING — prefilled
  // with whatever the profile did have.
  const identityPending = !isReady || (!!user && profileLoading);
  const profileHasIdentity =
    !!profile?.full_name?.trim() && !!profile?.email?.trim();
  const identified = isReady && !!user && !profileLoading && profileHasIdentity;

  useEffect(() => {
    if (!profile || profileHasIdentity) return;
    setDraft((prev) => ({
      ...prev,
      name: prev.name || (profile.full_name?.trim() ?? ""),
      email: prev.email || (profile.email?.trim() ?? ""),
    }));
  }, [profile, profileHasIdentity]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const markTouched = (key: FieldKey) =>
    setTouched((prev) => ({ ...prev, [key]: true }));

  const errors = useMemo(() => validate(draft, identified), [draft, identified]);
  const isValid = Object.keys(errors).length === 0;
  const selectedTopic = findSupportTopic(draft.topic);

  const showError = (key: FieldKey) => (touched[key] ? errors[key] : undefined);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;

    if (!isValid) {
      // Reveal every outstanding error at once rather than one per attempt.
      setTouched({ name: true, email: true, topic: true, message: true });
      return;
    }

    setSending(true);
    const { data, error } = await supabase.functions.invoke("contact-support", {
      body: {
        // Guests supply these; for a signed-in sender the server overrides them
        // from the profile, so sending blanks here is correct, not a gap.
        name: identified ? "" : draft.name.trim(),
        email: identified ? "" : draft.email.trim(),
        topic: draft.topic,
        subject: draft.subject.trim(),
        message: draft.message.trim(),
      },
    });
    setSending(false);

    if (error || data?.error) {
      hapticError();
      toast.error(
        data?.error ||
          (error
            ? await functionErrorMessage(
                error,
                "We couldn't send that — please try again.",
              )
            : "We couldn't send that — please try again."),
      );
      return;
    }

    setSent(true);
  };

  const reset = () => {
    setDraft({ name: draft.name, email: draft.email, topic: "", subject: "", message: "" });
    setTouched({});
    setSent(false);
  };

  return (
    // The compact header below carries the canonical BackButton.
    <PublicLayout>
      <PageIntro />

      <section className="container mx-auto px-5 pt-0 pb-8">
        <div className="page-measure mx-auto">

          {/* Right column — the form (or its success state). */}
          {/* Full 12 columns now that the left masthead is gone — at
              col-span-8 the form stayed in the first two-thirds of the grid
              and stranded an empty right third. Capped + centred so it
              doesn't stretch across the whole 90rem container. */}
          <div className="w-full">
            {sent ? (
              <div
                className="rounded-2xl px-6 py-12 flex flex-col items-center text-center gap-4 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300"
                style={PANEL_STYLE}
              >
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center"
                  style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
                >
                  <CheckCircle2
                    className="w-7 h-7"
                    style={{ color: "hsl(var(--burnt-sienna))" }}
                    strokeWidth={1.75}
                  />
                </div>
                <div className="space-y-2">
                  <h3
                    className="font-display font-bold text-ds-24 sm:text-ds-32 leading-tight"
                    style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
                  >
                    Message sent
                  </h3>
                  <p
                    className="font-sans text-ds-13 sm:text-ds-15 leading-relaxed max-w-md"
                    style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                  >
                    Our team will read it and reply by email — usually within one
                    business day. Nothing else to do on your end.
                  </p>
                </div>
                <Button variant="outline" onClick={reset} className="mt-2">
                  Send another
                </Button>
              </div>
            ) : (
              <form
                onSubmit={handleSubmit}
                noValidate
                className="rounded-2xl p-5 sm:p-6 lg:p-8 space-y-5"
                style={PANEL_STYLE}
              >
                {/* Identity — asked of guests, shown read-only to signed-in users. */}
                {identityPending ? (
                  <p
                    className="font-sans text-ds-13"
                    style={{ color: "hsl(var(--olivewood) / 0.75)" }}
                  >
                    Checking your session…
                  </p>
                ) : identified ? (
                  <div
                    className="rounded-2xl px-4 py-3"
                    style={{
                      background: "hsl(var(--bark) / 0.06)",
                      border: "1px solid hsl(var(--bark) / 0.16)",
                    }}
                  >
                    <p
                      className="font-sans text-ds-11 uppercase tracking-[0.14em]"
                      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      Sending as
                    </p>
                    <p
                      className="font-sans font-semibold text-ds-13 mt-1 truncate"
                      style={{ color: "hsl(var(--ink-deep))" }}
                    >
                      {profile?.full_name?.trim() || "Your account"}
                    </p>
                    {profile?.email && (
                      <p
                        className="font-sans text-ds-11 mt-0.5 truncate"
                        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                      >
                        {profile.email}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="support-name" className="text-ds-11">
                        Your name *
                      </Label>
                      <Input
                        id="support-name"
                        name="name"
                        autoComplete="name"
                        maxLength={NAME_MAX}
                        value={draft.name}
                        onChange={(e) => set("name", e.target.value)}
                        onBlur={() => markTouched("name")}
                        placeholder="Jane Doe"
                        aria-invalid={!!showError("name")}
                        aria-describedby={showError("name") ? "support-name-error" : undefined}
                        className="mt-1.5"
                      />
                      <FieldError id="support-name-error" message={showError("name")} />
                    </div>

                    <div>
                      <Label htmlFor="support-email" className="text-ds-11">
                        Your email *
                      </Label>
                      <Input
                        id="support-email"
                        name="email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        maxLength={EMAIL_MAX}
                        value={draft.email}
                        onChange={(e) => set("email", e.target.value)}
                        onBlur={() => markTouched("email")}
                        placeholder="you@example.com"
                        aria-invalid={!!showError("email")}
                        aria-describedby={showError("email") ? "support-email-error" : undefined}
                        className="mt-1.5"
                      />
                      <FieldError id="support-email-error" message={showError("email")} />
                    </div>
                  </div>
                )}

                {/* Topic */}
                <div>
                  <Label htmlFor="support-topic" className="text-ds-11">
                    What&apos;s this about? *
                  </Label>
                  <Select
                    value={draft.topic}
                    onValueChange={(value) => {
                      set("topic", value as SupportTopicKey);
                      markTouched("topic");
                    }}
                  >
                    <SelectTrigger
                      id="support-topic"
                      className="mt-1.5"
                      aria-invalid={!!showError("topic")}
                      aria-describedby={showError("topic") ? "support-topic-error" : undefined}
                    >
                      <SelectValue placeholder="Choose a topic" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORT_TOPICS.map((topic) => (
                        <SelectItem key={topic.key} value={topic.key}>
                          {topic.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {showError("topic") ? (
                    <FieldError id="support-topic-error" message={showError("topic")} />
                  ) : (
                    selectedTopic && (
                      <p
                        className="mt-1.5 font-sans text-ds-11 leading-snug"
                        style={{ color: "hsl(var(--olivewood) / 0.75)" }}
                      >
                        {selectedTopic.description}
                      </p>
                    )
                  )}
                </div>

                {/* Subject — optional, same as the in-app support tab. */}
                <div>
                  <Label htmlFor="support-subject" className="text-ds-11">
                    Subject <span className="text-muted-foreground/60">(optional)</span>
                  </Label>
                  <Input
                    id="support-subject"
                    name="subject"
                    maxLength={SUBJECT_MAX}
                    value={draft.subject}
                    onChange={(e) => set("subject", e.target.value)}
                    placeholder="Brief summary…"
                    className="mt-1.5"
                  />
                </div>

                {/* Message */}
                <div>
                  <div className="flex items-baseline justify-between gap-3">
                    <Label htmlFor="support-message" className="text-ds-11">
                      {selectedTopic ? `${selectedTopic.messageLabel} *` : "Your message *"}
                    </Label>
                    <span
                      className="font-sans text-ds-11 tabular-nums shrink-0"
                      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      {draft.message.length}/{MESSAGE_MAX}
                    </span>
                  </div>
                  <Textarea
                    id="support-message"
                    name="message"
                    maxLength={MESSAGE_MAX}
                    value={draft.message}
                    onChange={(e) => set("message", e.target.value)}
                    onBlur={() => markTouched("message")}
                    placeholder={
                      selectedTopic?.messagePlaceholder ?? "How can our team help you today?"
                    }
                    aria-invalid={!!showError("message")}
                    aria-describedby={showError("message") ? "support-message-error" : undefined}
                    className="mt-1.5 min-h-[180px] text-ds-13 leading-relaxed"
                  />
                  <FieldError id="support-message-error" message={showError("message")} />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full h-12 rounded-2xl"
                  disabled={sending || identityPending || !isValid}
                >
                  {sending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      {selectedTopic?.submitLabel ?? "Send message"}
                    </>
                  )}
                </Button>

                {/* No "Still needed: …" recap. Every required field already
                    carries a `*` in its own label, so the line restated
                    information the form was showing three inches above it. */}

              </form>
            )}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
};

export default Support;
