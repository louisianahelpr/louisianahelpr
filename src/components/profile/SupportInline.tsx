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
        <h1 className="text-page-title text-foreground">Message Sent!</h1>
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
    <div className="h-[calc(100dvh-8.5rem)] flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-page-title text-foreground leading-tight">Help & Support</h1>
          <p className="text-xs text-muted-foreground truncate">
            {selected ? `Sending as: ${selected.label}` : "Pick a category to get started."}
          </p>
        </div>
      </div>

      {!selected ? (
        <div className="grid grid-cols-2 gap-3 shrink-0">
          {supportCategories.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              className="relative rounded-xl border-2 border-border bg-card hover:border-primary/40 p-4 text-left transition-all active:scale-[0.98]"
            >
              <div className="mb-2 text-muted-foreground">{c.icon}</div>
              <p className="font-semibold text-sm text-foreground">{c.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
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
                className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 px-2 py-2 transition-all active:scale-[0.98] ${
                  isActive
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40"
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
          className="rounded-2xl border border-border bg-card p-4 flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto"
        >
          <div className="space-y-1">
            <Label htmlFor="support-subject" className="text-xs">
              Subject (optional)
            </Label>
            <Input
              id="support-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary…"
              maxLength={120}
              className="h-9"
            />
          </div>

          <div className="space-y-1 flex-1 min-h-0 flex flex-col">
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
              className="flex-1 min-h-[80px] resize-none"
            />
          </div>

          {selected.key === "report" && (
            <div className="space-y-1.5 shrink-0">
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
            className="w-full shrink-0"
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
