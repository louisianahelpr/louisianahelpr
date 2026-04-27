import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
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
    } catch (err: any) {
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
      <div className="text-center space-y-4 py-8 animate-in fade-in zoom-in-95 duration-300">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-display font-bold text-foreground">Message Sent!</h1>
        <p className="text-muted-foreground">
          Our team will review your message and get back to you soon.
        </p>
        <Button variant="outline" onClick={reset}>
          Send Another
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="h-11 w-11 -ml-2 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="font-display text-[28px] sm:text-[32px] font-bold leading-tight tracking-tight text-foreground flex items-center gap-2">
            <HelpCircle className="w-6 h-6 text-primary" /> Help & Support
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            {selected
              ? `Sending as: ${selected.label}`
              : "Pick a category to get started."}
          </p>
        </div>
      </div>

      {/* Category picker — always visible. The active card uses a bold
          primary border + soft tinted background so the user can see at a
          glance which type of message they're about to send. */}
      <div className="grid grid-cols-2 gap-3">
        {supportCategories.map((c) => {
          const isActive = category === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              aria-pressed={isActive}
              className={`relative rounded-xl border-2 p-4 text-left transition-all active:scale-[0.98] ${
                isActive
                  ? "border-primary bg-primary/10 shadow-sm"
                  : "border-border bg-card hover:border-primary/40"
              }`}
            >
              <div className={`mb-2 ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                {c.icon}
              </div>
              <p className="font-semibold text-sm text-foreground">{c.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                {c.description}
              </p>
              {isActive && (
                <span
                  aria-hidden
                  className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Form — hidden until a category is selected. Slides + fades in so
          the reveal feels native rather than a hard pop. */}
      {selected && (
        <form
          ref={formRef}
          key={selected.key /* re-mount triggers the animation when switching categories */}
          onSubmit={handleSubmit}
          className="rounded-2xl border border-border bg-card p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300"
        >
          <div className="space-y-1.5">
            <Label htmlFor="support-subject" className="text-xs">
              Subject (optional)
            </Label>
            <Input
              id="support-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary…"
              maxLength={120}
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
              rows={5}
              required
            />
          </div>

          {/* Screenshot upload — only rendered for the Report Issue flow. */}
          {selected.key === "report" && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
              <Label className="text-xs">Screenshot (optional)</Label>
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
                    className="max-h-40 w-auto object-cover"
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
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full justify-center"
                >
                  <ImagePlus className="w-4 h-4 mr-2" />
                  Upload Screenshot
                </Button>
              )}
              <p className="text-[11px] text-muted-foreground">
                A picture helps us reproduce the bug faster. PNG or JPG, up to 5MB.
              </p>
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
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
