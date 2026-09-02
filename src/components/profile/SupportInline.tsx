import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
import {
  MessageSquarePlus,
  Lightbulb,
  AlertTriangle,
  HelpCircle,
  Send,
  CheckCircle2,
  ImagePlus,
  X,
  Loader2,
  BookOpen,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { hapticError, hapticLight } from "@/lib/haptics";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import {
  SUPPORT_TOPICS,
  type SupportTopicKey as SupportCategory,
} from "@/lib/supportTopics";

// Topic copy (labels, descriptions, placeholders, submit labels, admin-facing
// reportLabel) is SHARED with the public /support page via
// src/lib/supportTopics.ts — the two support surfaces must not drift. Only the
// icons live here: that module stays JSX-free so the edge function's mirrored
// copy of it is easy to eyeball.
const CATEGORY_ICONS: Record<SupportCategory, React.ReactNode> = {
  message: <MessageSquarePlus className="w-4 h-4" />,
  suggestion: <Lightbulb className="w-4 h-4" />,
  report: <AlertTriangle className="w-4 h-4" />,
  other: <HelpCircle className="w-4 h-4" />,
};

const supportCategories = SUPPORT_TOPICS.map((topic) => ({
  ...topic,
  icon: CATEGORY_ICONS[topic.key],
}));

/**
 * Help & Support (signed-in) — A FORM, not a menu (owner, 2026-08-27).
 *
 * This screen used to open on a 2×2 grid of topic cards with a "Browse the
 * Help Center" card sitting underneath them, and no form at all until you
 * picked a card. Two things were wrong with that: the thing you came here to
 * do (write to us) was one navigation step away behind a picker, and the
 * self-serve Help Center link was parked BELOW the picker where the owner
 * did not want it.
 *
 * Now the form is the page. The reason is a row of chips at the top of the
 * form — preselected, and tappable to change — which is the same "click
 * option to change the reason" shape the public /support page offers through
 * its <Select>. The option list itself is NOT forked: both surfaces read
 * `SUPPORT_TOPICS` from `src/lib/supportTopics.ts`, so they cannot drift.
 *
 * The Help Center link now sits BELOW the card (owner, 2026-08-31: "Help
 * center move below this card"). Note this reverses the 2026-08-27 placement
 * described above — what the owner objected to then was a full CARD parked
 * under a topic PICKER, on a screen with no form. The screen is a form now,
 * so "below" means "after the Send button", and self-serve is the fallback
 * you offer after the ask rather than a detour in front of it.
 *
 * The topic control is a DROPDOWN (owner, 2026-08-31: "Keep all 4 2x2 or Or
 * just make it a drop down how the public help and support does"). It was a
 * row of chips, which could not hold four options evenly — three across
 * orphaned `Other` onto a second row by itself. Rather than invent a fourth
 * shape, this now renders the SAME `<Select>` the public /support page uses
 * over the SAME `SUPPORT_TOPICS` list, so the two support surfaces share one
 * control instead of two spellings of one question. All four topics stay;
 * see the note in `src/lib/supportTopics.ts` for why `Other` is kept even
 * though it converges with `Message Admin`.
 */

/** Inline field error — same shape as /support's FieldError (role="alert" +
 *  the id the control points at via aria-describedby). */
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

export function SupportInline({ userId, onBack }: { userId?: string; onBack: () => void }) {
  // Preselected rather than null: the form has to be usable the instant it
  // paints, and "Message Admin" is the general case the other two narrow.
  const [category, setCategory] = useState<SupportCategory>("message");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  // Errors appear once the field is blurred or submit is attempted, so the
  // form doesn't shout at someone who simply hasn't typed yet.
  const [messageTouched, setMessageTouched] = useState(false);

  // Bug-report screenshot state — only rendered when category === "report".
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const selected =
    supportCategories.find((c) => c.key === category) ?? supportCategories[0];

  const messageError = !message.trim() ? "Tell us what's going on." : undefined;
  const showMessageError = messageTouched ? messageError : undefined;

  // Clear the screenshot if the user switches away from "Report Issue".
  useEffect(() => {
    if (category !== "report" && screenshot) {
      URL.revokeObjectURL(screenshotPreview || "");
      setScreenshot(null);
      setScreenshotPreview(null);
    }
  }, [category]);

  const handleScreenshotPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Select an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Screenshot must be under 5 MB.");
      return;
    }
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshot(file);
    setScreenshotPreview(URL.createObjectURL(file));
  };

  const removeScreenshot = () => {
    if (screenshotPreview) URL.revokeObjectURL(screenshotPreview);
    setScreenshot(null);
    setScreenshotPreview(null);
  };

  const uploadScreenshot = async (file: File): Promise<string | null> => {
    if (!userId) return null;
    setUploadingScreenshot(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${userId}/support/${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("user-documents")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      // user-documents bucket is private as of 2026-05-05; embed a signed
      // URL with 30-day TTL into the support ticket so the admin can view
      // it without needing UI changes. Most tickets resolve in <30 days;
      // older ones can be re-fetched by path if needed.
      const { data, error: signErr } = await supabase.storage
        .from("user-documents")
        .createSignedUrl(path, 30 * 24 * 60 * 60);
      if (signErr || !data) throw signErr || new Error("No signed URL");
      return data.signedUrl;
    } catch {
      toast.error("Couldn't upload screenshot — sending without it.");
      return null;
    } finally {
      setUploadingScreenshot(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || uploadingScreenshot) return;

    // Reveal the outstanding error rather than sitting behind a wordless
    // disabled button — the same reveal-on-submit branch /support runs. A
    // button disabled on `!message.trim()` made this branch dead code and
    // left the user tapping a greyed control with nothing telling them why.
    if (!userId || messageError) {
      setMessageTouched(true);
      return;
    }

    setSending(true);

    let screenshotUrl: string | null = null;
    if (category === "report" && screenshot) {
      screenshotUrl = await uploadScreenshot(screenshot);
    }

    const description = screenshotUrl
      ? `${message.trim()}\n\nScreenshot: ${screenshotUrl}`
      : message.trim();

    const { error } = await supabase.from("reports").insert({
      reporter_id: userId,
      reported_type: "support",
      reported_id: userId,
      reason: `[${selected.reportLabel}] ${subject.trim() || "No subject"}`,
      description,
    });
    setSending(false);
    if (error) {
      hapticError();
      toast.error("We couldn't send that — please try again.");
    } else {
      setSent(true);
    }
  };

  const reset = () => {
    setCategory("message");
    setSubject("");
    setMessage("");
    setMessageTouched(false);
    setSent(false);
    removeScreenshot();
  };

  if (sent) {
    return (
      <div className="rounded-2xl liquid-glass flex flex-col items-center text-center gap-4 px-6 py-12 animate-in fade-in zoom-in-95 duration-300">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
          <CheckCircle2 className="w-7 h-7 text-primary" />
        </div>
        <div className="space-y-1">
          <h1 className="font-display italic font-bold leading-tight text-headline-hero" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}>
            Message sent
          </h1>
          <p className="font-serif italic max-w-sm" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Our team will review and get back to you soon.
          </p>
        </div>
        <Button variant="outline" onClick={reset}>
          Send Another
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ProfileTabHeader title="Help & Support" onBack={onBack} />

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        noValidate
        className="rounded-2xl liquid-glass p-5 space-y-4"
      >
        {/* Reason — the click-to-change control. Same three options the
            public /support <Select> renders, from the one shared list. */}
        <div>
          {/* A real <Label htmlFor> now that the control is a <Select> — the
              same pairing /support uses. It was a bare <p> + aria-labelledby
              because the control used to be a radiogroup, which has no
              labelable form element to point at. */}
          <Label htmlFor="support-reason" className="text-ds-11">
            What&apos;s this about?
          </Label>
          {/* A DROPDOWN, not a chip row (owner, 2026-08-31: "just make it a
              drop down how the public help and support does").
              This is deliberately the SAME control the public /support page
              uses — `<Select>` over the same `SUPPORT_TOPICS` list — so the
              two support surfaces are now one control, not two shapes of the
              same question. Four topics never sat evenly in a chip row (three
              across orphaned the fourth onto its own line); a dropdown holds
              any number of them in one row and scales if a fifth is added.
              Radix, not a native <select>: it is what /support already ships
              inside this same Capacitor/WKWebView build, so it is the proven
              option here. */}
          <Select
            value={category}
            onValueChange={(value) => {
              hapticLight();
              setCategory(value as SupportCategory);
            }}
          >
            <SelectTrigger id="support-reason" className="mt-2">
              <SelectValue placeholder="Choose a topic" />
            </SelectTrigger>
            <SelectContent>
              {supportCategories.map((c) => (
                <SelectItem
                  key={c.key}
                  value={c.key}
                  // Project rule: a SELECTED control is glossy — the same
                  // radial bark gradient every primary CTA wears, never a flat
                  // tint. Styled here rather than in ui/select.tsx because
                  // that file is shared with every other Select in the app.
                  //
                  // The gloss is toggled in JS, NOT with a
                  // `data-[state=checked]:btn-grad-primary` variant: Tailwind
                  // variants only compose over utilities Tailwind generates,
                  // and `.btn-grad-primary` is a hand-written class in
                  // index.css. That variant silently compiles to nothing and
                  // the selected row renders flat — which is the exact defect
                  // this rule exists to prevent. Every other call site
                  // (CredentialTierSelector, ReportDialog, ReviewForm) toggles
                  // it the same way.
                  //
                  // `min-h-[44px]` + py-2.5 take the option row from the
                  // shared ~30px default up to a real touch target.
                  className={
                    "min-h-[44px] py-2.5 text-ds-13 rounded-ds-md " +
                    (c.key === category
                      ? "btn-grad-primary !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))]"
                      : "")
                  }
                >
                  <span className="flex items-center gap-2">
                    {/* Lucide icons stroke with `currentColor`, so the
                        checked-state colour override above reaches them. */}
                    <span className="shrink-0" aria-hidden>
                      {c.icon}
                    </span>
                    <span className="font-sans font-semibold">{c.label}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* The chosen reason's one-line explanation — the same copy the
              public form shows under its Select. */}
          <p
            className="mt-2 font-sans text-ds-11 leading-snug"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            {selected.description}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="support-subject" className="text-ds-11">
            Subject <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="support-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={120}
            className="h-10"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="support-message" className="text-ds-11">
            {/* Per-topic label ("Your idea", "What went wrong?"…) comes from
                the shared topic config so /support shows the same wording. */}
            {selected.messageLabel} *
          </Label>
          <Textarea
            id="support-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onBlur={() => setMessageTouched(true)}
            placeholder={selected.messagePlaceholder}
            aria-invalid={!!showMessageError}
            aria-describedby={showMessageError ? "support-message-error" : undefined}
            className="min-h-[160px] resize-none text-ds-13 leading-relaxed"
          />
          <FieldError id="support-message-error" message={showMessageError} />
        </div>

        {selected.key === "report" && (
          <div className="space-y-1.5">
            <Label className="text-ds-11">Screenshot <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleScreenshotPick}
            />
            {screenshotPreview && screenshotPreview.startsWith("blob:") ? (
              <div className="relative inline-block rounded-ds-md overflow-hidden border border-border">
                <img loading="lazy" decoding="async"
                  src={screenshotPreview}
                  alt="Screenshot preview"
                  className="max-h-24 w-auto object-cover"
                />
                <button
                  type="button"
                  onClick={removeScreenshot}
                  aria-label="Remove screenshot"
                  className="absolute top-0 right-0 h-10 w-10 flex items-center justify-center active:scale-[0.95] transition-transform"
                >
                  <span className="h-7 w-7 rounded-full bg-background/90 backdrop-blur flex items-center justify-center text-foreground shadow">
                    <X className="w-3.5 h-3.5" />
                  </span>
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="w-full justify-center"
              >
                <ImagePlus className="w-4 h-4 mr-2" />
                Upload Screenshot
              </Button>
            )}
          </div>
        )}

        {/* Not gated on an empty message: a tap runs handleSubmit's
            reveal-branch, which names the field that is missing. */}
        <Button type="submit" className="w-full h-11" disabled={sending || uploadingScreenshot}>
          {sending || uploadingScreenshot ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {uploadingScreenshot ? "Uploading…" : "Sending…"}
            </>
          ) : (
            <>
              <Send className="w-4 h-4 mr-2" />
              {selected.submitLabel}
            </>
          )}
        </Button>
      </form>

      {/* Self-serve KB — parity with the web footer's Help Center link so app
          users can search the FAQ before opening a ticket (LH-46).
          BELOW the card, after Send Message (owner, 2026-08-31: "Help center
          move below this card"). The form is the primary action and this is
          the fallback, so it reads as an offer AFTER the ask rather than a
          detour before it.
          It gets its own bordered row — not a bare line — because a plain
          link hanging under a card reads as a footnote/caption belonging to
          the form. Its own surface plus a gap DOUBLE the parent's rhythm are
          what separate it from the card above.
          The `!` on the margin is load-bearing: the parent's `space-y-3`
          compiles to `.space-y-3 > :not([hidden]) ~ :not([hidden])`, which
          outranks a plain `.mt-6` on specificity — without the important
          modifier this row snapped back to the same 12px gap that sits
          between the header and the card, and read as part of the form. */}
      <Link
        to="/help"
        className="!mt-6 flex items-center gap-2.5 rounded-2xl px-4 py-3 transition-colors active:opacity-70 hover:brightness-[0.98]"
        style={{
          background: "hsl(var(--parchment))",
          border: "0.5px solid hsl(var(--border) / 0.7)",
          boxShadow: "var(--elev-inset-gloss)",
        }}
      >
        <BookOpen className="w-4 h-4 text-primary shrink-0" aria-hidden />
        <p className="flex-1 min-w-0 font-sans text-ds-12 leading-snug" style={{ color: "hsl(var(--olivewood) / 0.9)" }}>
          Quick answer?{" "}
          <span className="font-semibold underline" style={{ color: "hsl(var(--bark))" }}>
            Browse the Help Center
          </span>
        </p>
        <ChevronRight aria-hidden className="w-4 h-4 text-muted-foreground shrink-0" />
      </Link>
    </div>
  );
}
