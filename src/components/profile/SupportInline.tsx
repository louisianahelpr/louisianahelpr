import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, MessageSquarePlus, Lightbulb, AlertTriangle, HelpCircle, Send, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type SupportCategory = "message" | "suggestion" | "report" | "help";

const supportCategories: { key: SupportCategory; label: string; icon: React.ReactNode; description: string }[] = [
  { key: "message", label: "Message Admin", icon: <MessageSquarePlus className="w-5 h-5" />, description: "Send a direct message to the admin team" },
  { key: "suggestion", label: "Suggestion", icon: <Lightbulb className="w-5 h-5" />, description: "Share an idea to improve the platform" },
  { key: "report", label: "Report Issue", icon: <AlertTriangle className="w-5 h-5" />, description: "Report a bug, problem, or concern" },
  { key: "help", label: "Get Help", icon: <HelpCircle className="w-5 h-5" />, description: "Ask a question or request assistance" },
];

export function SupportInline({ userId, onBack }: { userId?: string; onBack: () => void }) {
  const [category, setCategory] = useState<SupportCategory | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !category || !message.trim()) return;
    setSending(true);
    const labels: Record<SupportCategory, string> = { message: "Admin Message", suggestion: "Suggestion", report: "Issue Report", help: "Help Request" };
    const { error } = await supabase.from("reports").insert({
      reporter_id: userId,
      reported_type: "support",
      reported_id: userId,
      reason: `[${labels[category]}] ${subject.trim() || "No subject"}`,
      description: message.trim(),
    });
    setSending(false);
    if (error) { toast.error("Failed to send. Please try again."); }
    else { setSent(true); toast.success("Message sent to admin!"); }
  };

  const reset = () => { setCategory(null); setSubject(""); setMessage(""); setSent(false); };

  if (sent) {
    return (
      <div className="text-center space-y-4 py-8">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-display font-bold text-foreground">Message Sent!</h1>
        <p className="text-muted-foreground">Our team will review your message and get back to you soon.</p>
        <Button variant="outline" onClick={reset}>Send Another</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <HelpCircle className="w-6 h-6 text-primary" /> Help & Support
          </h1>
          <p className="text-sm text-muted-foreground">Message admin, share suggestions, or report issues</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {supportCategories.map((c) => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            className={`rounded-xl border p-4 text-left transition-all ${
              category === c.key
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border bg-card hover:border-primary/40"
            }`}
          >
            <div className={`mb-2 ${category === c.key ? "text-primary" : "text-muted-foreground"}`}>
              {c.icon}
            </div>
            <p className="font-medium text-sm text-foreground">{c.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
          </button>
        ))}
      </div>

      {category && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="support-subject" className="text-xs">Subject (optional)</Label>
            <Input id="support-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="support-message" className="text-xs">Your message *</Label>
            <Textarea id="support-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe in detail…" rows={5} required />
          </div>
          <Button type="submit" className="w-full" disabled={sending || !message.trim()}>
            {sending ? "Sending…" : <><Send className="w-4 h-4 mr-2" /> Send Message</>}
          </Button>
        </form>
      )}
    </div>
  );
}
