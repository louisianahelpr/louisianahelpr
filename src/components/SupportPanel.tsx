import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  HelpCircle, MessageSquarePlus, Lightbulb, AlertTriangle, Send, CheckCircle2,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";

type Category = "message" | "suggestion" | "report" | "help";

const categories: { key: Category; label: string; icon: React.ReactNode; description: string }[] = [
  { key: "message", label: "Message Admin", icon: <MessageSquarePlus className="w-4 h-4" />, description: "Direct message to admin" },
  { key: "suggestion", label: "Suggestion", icon: <Lightbulb className="w-4 h-4" />, description: "Share an idea" },
  { key: "report", label: "Report Issue", icon: <AlertTriangle className="w-4 h-4" />, description: "Report a bug or concern" },
  { key: "help", label: "Get Help", icon: <HelpCircle className="w-4 h-4" />, description: "Ask a question" },
];

const SupportPanel = () => {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (open && !user) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) setUser(session.user);
      });
    }
  }, [open, user]);

  const reset = () => {
    setCategory(null);
    setSubject("");
    setMessage("");
    setSent(false);
  };

  // Reset when panel closes
  useEffect(() => {
    if (!open) {
      setTimeout(reset, 300);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !category || !message.trim()) return;

    setSending(true);
    const categoryLabels: Record<Category, string> = {
      message: "Admin Message",
      suggestion: "Suggestion",
      report: "Issue Report",
      help: "Help Request",
    };

    const { error } = await supabase.from("reports").insert({
      reporter_id: user.id,
      reported_type: "support",
      reported_id: user.id,
      reason: `[${categoryLabels[category]}] ${subject.trim() || "No subject"}`,
      description: message.trim(),
    });

    setSending(false);
    if (error) {
      toast.error("Failed to send. Please try again.");
    } else {
      setSent(true);
      toast.success("Message sent to admin!");
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" title="Help & Support" className="hover:bg-accent/20 hover:text-accent-foreground btn-press rounded-xl h-9 w-9">
          <HelpCircle className="w-4 h-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md p-0">
        <SheetHeader className="p-4 border-b border-border">
          <SheetTitle className="font-display">Support & Feedback</SheetTitle>
        </SheetHeader>
        <div className="overflow-y-auto max-h-[calc(100vh-5rem)] p-4">
          {sent ? (
            <div className="text-center py-12 space-y-4">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7 text-primary" />
              </div>
              <h2 className="text-lg font-display font-bold text-foreground">Message Sent!</h2>
              <p className="text-sm text-muted-foreground">Our team will review your message and get back to you soon.</p>
              <div className="flex gap-3 justify-center pt-2">
                <Button variant="outline" size="sm" onClick={reset}>Send Another</Button>
                <Button size="sm" onClick={() => setOpen(false)}>Close</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Message admin, share suggestions, or report issues
              </p>

              <div className="grid grid-cols-2 gap-2">
                {categories.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setCategory(c.key)}
                    className={`rounded-xl border p-3 text-left transition-all ${
                      category === c.key
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <div className={`mb-1.5 ${category === c.key ? "text-primary" : "text-muted-foreground"}`}>
                      {c.icon}
                    </div>
                    <p className="font-medium text-xs text-foreground">{c.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{c.description}</p>
                  </button>
                ))}
              </div>

              {category && (
                <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="support-subject" className="text-xs">Subject (optional)</Label>
                    <Input
                      id="support-subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Brief summary…"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="support-message" className="text-xs">Your message *</Label>
                    <Textarea
                      id="support-message"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Describe in detail…"
                      rows={4}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={sending || !message.trim()}>
                    {sending ? "Sending…" : <><Send className="w-4 h-4 mr-2" /> Send Message</>}
                  </Button>
                </form>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default SupportPanel;
