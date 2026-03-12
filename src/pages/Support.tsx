import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft, MessageSquarePlus, Lightbulb, AlertTriangle, HelpCircle, Send, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import { usePageTitle } from "@/hooks/usePageTitle";

type Category = "message" | "suggestion" | "report" | "help";

const categories: { key: Category; label: string; icon: React.ReactNode; description: string }[] = [
  { key: "message", label: "Message Admin", icon: <MessageSquarePlus className="w-5 h-5" />, description: "Send a direct message to the admin team" },
  { key: "suggestion", label: "Suggestion", icon: <Lightbulb className="w-5 h-5" />, description: "Share an idea to improve the platform" },
  { key: "report", label: "Report Issue", icon: <AlertTriangle className="w-5 h-5" />, description: "Report a bug, problem, or concern" },
  { key: "help", label: "Get Help", icon: <HelpCircle className="w-5 h-5" />, description: "Ask a question or request assistance" },
];

const SupportPage = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) { navigate("/login"); return; }
      setUser(session.user);
    });
  }, [navigate]);

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

    // Store as a report with type "support"
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

  const reset = () => {
    setCategory(null);
    setSubject("");
    setMessage("");
    setSent(false);
  };

  if (sent) {
    return (
      <div className="min-h-screen bg-background pb-20 md:pb-0">
        <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
          <div className="container mx-auto flex items-center h-16 px-4 gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
          </div>
        </header>
        <main className="container mx-auto px-4 py-12">
          <div className="max-w-md mx-auto text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-display font-bold text-foreground">Message Sent!</h1>
            <p className="text-muted-foreground">Our team will review your message and get back to you soon.</p>
            <div className="flex gap-3 justify-center pt-4">
              <Button variant="outline" onClick={reset}>Send Another</Button>
              <Button onClick={() => navigate("/dashboard")}>Back to Dashboard</Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center h-16 px-4 gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="max-w-lg mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Support & Feedback</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Message admin, share suggestions, or report issues
            </p>
          </div>

          {/* Category selector */}
          <div className="grid grid-cols-2 gap-3">
            {categories.map((c) => (
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

          {/* Form */}
          {category && (
            <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="subject" className="text-xs">Subject (optional)</Label>
                <Input
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Brief summary…"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="message" className="text-xs">Your message *</Label>
                <Textarea
                  id="message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe in detail…"
                  rows={5}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={sending || !message.trim()}>
                {sending ? "Sending…" : (
                  <>
                    <Send className="w-4 h-4 mr-2" /> Send Message
                  </>
                )}
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};

export default SupportPage;
