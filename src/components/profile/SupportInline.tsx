import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "lucide-react";
import { toast } from "sonner";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";

type SupportCategory = "message" | "suggestion" | "report" | "help";

interface CategoryConfig {
  key: SupportCategory;
  label: string;
  icon: React.ReactNode;
  description: string;
  /** Placeholder for the main message textarea, written specifically for the
   *  selected category so the form feels tailored, not generic. */
  messagePlaceholder: string;
  /** Submit-button label tuned to the action (Send Idea vs Report Bug, etc). */
  submitLabel: string;
  /** Stored prefix on the report so admins can triage faster. */
  reportLabel: string;
}

const supportCategories: CategoryConfig[] = [
  {
    key: "message",
    label: "Message Admin",
    icon: <MessageSquarePlus className="w-5 h-5" />,
    description: "Send a direct message to the admin team",
    messagePlaceholder: "How can our team help you today?",
    submitLabel: "Send Message",
    reportLabel: "Admin Message",
  },
  {
    key: "suggestion",
    label: "Suggestion",
    icon: <Lightbulb className="w-5 h-5" />,
    description: "Share an idea to improve the platform",
    messagePlaceholder: "Describe your idea to improve Helpr…",
    submitLabel: "Send Suggestion",
    reportLabel: "Suggestion",
  },
  {
    key: "report",
    label: "Report Issue",
    icon: <AlertTriangle className="w-5 h-5" />,
    description: "Report a bug, problem, or concern",
    messagePlaceholder: "Please describe the bug or technical problem…",
    submitLabel: "Report Issue",
    reportLabel: "Issue Report",
  },
  {
    key: "help",
    label: "Get Help",
    icon: <HelpCircle className="w-5 h-5" />,
    description: "Ask a question or request assistance",
    messagePlaceholder: "What is your question regarding our services?",
    submitLabel: "Send Question",
    reportLabel: "Help Request",
  },
];

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

  // Auto-scroll the form into view when a category is picked so users don't
  // have to hunt for the newly-revealed inputs (especially on small screens
  // where the form sits below the fold under the 4 category cards).
  useEffect(() => {
    if (!category) return;
    const t = window.setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 120);
    return () => window.clearTimeout(t);
  }, [category]);

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
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Screenshot must be under 5MB");
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
      const { data } = supabase.storage.from("user-documents").getPublicUrl(path);
      return data.publicUrl;
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
      toast.error("Failed to send. Please try again.");
    } else {
      setSent(true);
      toast.success("Message sent to admin!");
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
          <p className="font-serif italic uppercase" style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
            Sent
          </p>
          <h1 className="font-display italic font-bold leading-tight" style={{ fontSize: "1.5rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}>
            Message sent
          </h1>
          <p className="font-serif italic max-w-sm" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
            Our team will review and get back to you soon.
          </p>
        </div>
        <Button variant="outline" onClick={reset}>
          Send another
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24">
      <ProfileTabHeader
        eyebrow="Concierge"
        title="Help &amp; support"
        meta={selected ? `Sending as: ${selected.label}` : "Pick a category to get started."}
        onBack={onBack}
      />

      {!selected ? (
        <div className="grid grid-cols-2 gap-3 shrink-0">
          {supportCategories.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              className="relative rounded-2xl liquid-glass hover:border-primary/40 p-4 text-left transition-all hover:-translate-y-0.5 active:scale-[0.98]"
            >
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center mb-2.5 text-primary">
                {c.icon}
              </div>
              <p className="font-display italic font-bold leading-tight" style={{ fontSize: "0.95rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}>
                {c.label}
              </p>
              <p className="font-serif italic mt-1 leading-snug" style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                {c.description}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2 shrink-0">
          {supportCategories.map((c) => {
            const isActive = category === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                aria-pressed={isActive}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2.5 transition-all active:scale-[0.98] ${
                  isActive
                    ? "border-2 border-primary bg-primary/10 text-primary"
                    : "liquid-glass text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className={`w-4 h-4 ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                  {c.icon}
                </div>
                <p className={`text-[11px] font-semibold leading-tight text-center ${isActive ? "text-foreground" : "text-foreground/80"}`}>
                  {c.label}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <form
          ref={formRef}
          key={selected.key}
          onSubmit={handleSubmit}
          className="rounded-2xl liquid-glass p-5 space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="support-subject" className="text-xs">
              Subject <span className="text-muted-foreground/60">(optional)</span>
            </Label>
            <Input
              id="support-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary…"
              maxLength={120}
              className="h-10"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="support-message" className="text-xs">
              {selected.key === "suggestion"
                ? "Your idea *"
                : selected.key === "report"
                ? "What went wrong? *"
                : selected.key === "help"
                ? "Your question *"
                : "Your message *"}
            </Label>
            <Textarea
              id="support-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={selected.messagePlaceholder}
              required
              className="min-h-[160px] resize-none text-sm leading-relaxed"
            />
          </div>

          {selected.key === "report" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Screenshot <span className="text-muted-foreground/60">(optional)</span></Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleScreenshotPick}
              />
              {screenshotPreview ? (
                <div className="relative inline-block rounded-xl overflow-hidden border border-border">
                  <img
                    src={screenshotPreview}
                    alt="Screenshot preview"
                    className="max-h-24 w-auto object-cover"
                  />
                  <button
                    type="button"
                    onClick={removeScreenshot}
                    aria-label="Remove screenshot"
                    className="absolute top-1.5 right-1.5 h-7 w-7 rounded-full bg-background/90 backdrop-blur flex items-center justify-center text-foreground shadow"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full justify-center h-9"
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
