import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MessageSquarePlus, Lightbulb, AlertTriangle, HelpCircle, Send, CheckCircle2,
  Mail, Clock, FileText, Shield,
} from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import { usePageTitle } from "@/hooks/usePageTitle";
import PageHeader from "@/components/PageHeader";

type Category = "message" | "suggestion" | "report" | "help";

const categories: { key: Category; label: string; icon: React.ReactNode; description: string }[] = [
  { key: "message", label: "Message Admin", icon: <MessageSquarePlus className="w-5 h-5" />, description: "Send a direct message to the admin team" },
  { key: "suggestion", label: "Suggestion", icon: <Lightbulb className="w-5 h-5" />, description: "Share an idea to improve the platform" },
  { key: "report", label: "Report Issue", icon: <AlertTriangle className="w-5 h-5" />, description: "Report a bug, problem, or concern" },
  { key: "help", label: "Get Help", icon: <HelpCircle className="w-5 h-5" />, description: "Ask a question or request assistance" },
];

const faqItems = [
  { q: "How do I post a job?", a: "Sign in, go to your Dashboard, and tap \"Post a Job.\" Fill in the details like category, date, budget, and location." },
  { q: "How do I apply to help with a job?", a: "Browse available jobs on the Dashboard. Tap a job to view details, then tap \"Apply\" and include a message to the poster." },
  { q: "How do payments work?", a: "Payments are processed securely through Stripe. Funds are held until the job is completed and confirmed by both parties." },
  { q: "How do I cancel a job?", a: "Go to your Activity page, find the job, and tap \"Cancel.\" Note that late cancellations may incur a fee." },
  { q: "How do I contact the admin?", a: "Use the support form on this page (sign in required), or email us at admin@louisianahelpr.com." },
  { q: "Is my personal information safe?", a: "Yes. We use industry-standard encryption and never share your data with third parties. See our Privacy Policy for details." },
];

const SupportPage = () => {
  usePageTitle("Support — Helpr");
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setUser(session.user);
    });
  }, []);

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

  const reset = () => {
    setCategory(null);
    setSubject("");
    setMessage("");
    setSent(false);
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <PageHeader title="Support & Help Center" />

      <main className="container mx-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-8">
          <p className="text-sm text-muted-foreground">
            Find answers, get help, or contact our team
          </p>

          {/* Contact info — always visible, no login required */}
          <section className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Contact Us</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm text-foreground">Email</p>
                  <a href="mailto:admin@louisianahelpr.com" className="text-sm text-primary hover:underline">
                    admin@louisianahelpr.com
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm text-foreground">Response Time</p>
                  <p className="text-sm text-muted-foreground">Within 24–48 hours</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm text-foreground">Policies</p>
                  <div className="flex gap-2">
                    <Link to="/terms" className="text-sm text-primary hover:underline">Terms</Link>
                    <span className="text-muted-foreground">·</span>
                    <Link to="/privacy" className="text-sm text-primary hover:underline">Privacy</Link>
                    <span className="text-muted-foreground">·</span>
                    <Link to="/rules" className="text-sm text-primary hover:underline">Rules</Link>
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-sm text-foreground">Safety</p>
                  <p className="text-sm text-muted-foreground">All helprs are reviewed before approval</p>
                </div>
              </div>
            </div>
          </section>

          {/* FAQ — always visible */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Frequently Asked Questions</h2>
            <div className="space-y-2">
              {faqItems.map((item, i) => (
                <details key={i} className="rounded-xl border border-border bg-card group">
                  <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-foreground hover:text-primary transition-colors list-none flex items-center justify-between">
                    {item.q}
                    <span className="text-muted-foreground group-open:rotate-180 transition-transform">▾</span>
                  </summary>
                  <p className="px-4 pb-3 text-sm text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          {/* Authenticated support form */}
          {user ? (
            sent ? (
              <section className="text-center space-y-4 py-6">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-xl font-display font-bold text-foreground">Message Sent!</h2>
                <p className="text-muted-foreground">Our team will review your message and get back to you soon.</p>
                <div className="flex gap-3 justify-center pt-2">
                  <Button variant="outline" onClick={reset}>Send Another</Button>
                  <Button onClick={() => navigate("/dashboard")}>Back to Dashboard</Button>
                </div>
              </section>
            ) : (
              <section className="space-y-4">
                <h2 className="text-lg font-semibold text-foreground">Send Us a Message</h2>
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
              </section>
            )
          ) : (
            <section className="rounded-xl border border-border bg-card p-5 text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                Sign in to send a message directly to our support team, or email us at{" "}
                <a href="mailto:admin@louisianahelpr.com" className="text-primary hover:underline">
                  admin@louisianahelpr.com
                </a>
              </p>
              <Link to="/login">
                <Button variant="outline" size="sm">Sign In</Button>
              </Link>
            </section>
          )}
        </div>
      </main>
    </div>
  );
};

export default SupportPage;
