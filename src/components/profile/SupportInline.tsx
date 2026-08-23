import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  MessageSquarePlus,
  Lightbulb,
  AlertTriangle,
  Send,
  CheckCircle2,
  ImagePlus,
  X,
  Loader2,
  BookOpen,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
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
  message: <MessageSquarePlus className="w-5 h-5" />,
  suggestion: <Lightbulb className="w-5 h-5" />,
  report: <AlertTriangle className="w-5 h-5" />,
};

const supportCategories = SUPPORT_TOPICS.map((topic) => ({
  ...topic,
  icon: CATEGORY_ICONS[topic.key],
}));

export function SupportInline({ userId, onBack }: { userId?: string; onBack: () => void }) {
  const [category, setCategory] = useState<SupportCategory | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Bug-report screenshot state — only rendered when category === "report".
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const selected = supportCategories.find((c) => c.key === category) ?? null;

  // (Previously: a `scrollIntoView` fired on category selection that lurched
  // the whole page downward and felt like a hard screen change. Removed —
  // the form now expands in place below the cards, no auto-scroll.)

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
      toast.error("Select an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Screenshot must be under 5 MB");
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
    if (!userId || !selected || !message.trim()) return;
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
      toast.success("Message sent to admin.");
    }
  };

  const reset = () => {
    setCategory(null);
    setSubject("");
    setMessage("");
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
    <div className="space-y-4">
      <ProfileTabHeader
        title={selected ? selected.label : "Help & Support"}
        onBack={selected ? () => setCategory(null) : onBack}
      />

      {/* Drill-in: the picker grid and the form are mutually exclusive.
          Tapping a card replaces the grid with its full-width form; the
          header back arrow returns to the grid. This reads as a real
          navigation step instead of a form popping open below four
          always-on cards. */}
      {!selected && (
        <div className="grid grid-cols-2 gap-3">
          {supportCategories.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              className="relative rounded-2xl liquid-glass p-4 text-left transition-all active:scale-[0.98] hover:border-primary/40 hover:-translate-y-0.5"
            >
              <div className="w-9 h-9 rounded-full flex items-center justify-center mb-2.5 bg-primary/10 text-primary">
                {c.icon}
              </div>
              <p className="font-display italic font-bold leading-tight text-ds-15" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                {c.label}
              </p>
              <p className="font-serif italic mt-1 leading-snug text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                {c.description}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Self-serve KB — parity with the web footer's Help Center link so
          app users can search the FAQ before opening a ticket (LH-46). */}
      {!selected && (
        <Link
          to="/help"
          className="flex items-center gap-3 rounded-2xl liquid-glass p-4 transition-all active:scale-[0.98] hover:-translate-y-0.5"
        >
          <div className="w-9 h-9 rounded-full flex items-center justify-center bg-primary/10 text-primary shrink-0">
            <BookOpen className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display italic font-bold leading-tight text-ds-15" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
              Browse the Help Center
            </p>
            <p className="font-serif italic mt-1 leading-snug text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Search answers about jobs, payments, and your account
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </Link>
      )}

      {selected && (
        <form
          ref={formRef}
          key={selected.key}
          onSubmit={handleSubmit}
          className="rounded-2xl liquid-glass p-5 space-y-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-2 motion-safe:duration-200"
        >
          <div className="space-y-1.5">
            <Label htmlFor="support-subject" className="text-ds-11">
              Subject <span className="text-muted-foreground/60">(optional)</span>
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
              placeholder={selected.messagePlaceholder}
              required
              className="min-h-[160px] resize-none text-ds-13 leading-relaxed"
            />
          </div>

          {selected.key === "report" && (
            <div className="space-y-1.5">
              <Label className="text-ds-11">Screenshot <span className="text-muted-foreground/60">(optional)</span></Label>
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

          <Button
            type="submit"
            className="w-full h-11"
            disabled={sending || uploadingScreenshot || !message.trim()}
          >
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
      )}
    </div>
  );
}
