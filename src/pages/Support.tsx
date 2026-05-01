import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MessageSquarePlus, Lightbulb, AlertTriangle, HelpCircle, Send, CheckCircle2,
  Mail, Clock, FileText, Shield, Search, Upload, X,
} from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import { usePageTitle } from "@/hooks/usePageTitle";
import Navbar from "@/components/Navbar";
import BackButton from "@/components/BackButton";

type Category = "message" | "suggestion" | "report" | "help";

const categories: { key: Category; label: string; icon: React.ReactNode; description: string; accent: string }[] = [
  { key: "message", label: "Message Admin", icon: <MessageSquarePlus className="w-4 h-4" />, description: "Direct message", accent: "from-primary/15 to-primary/5 text-primary" },
  { key: "suggestion", label: "Suggestion", icon: <Lightbulb className="w-4 h-4" />, description: "Share an idea", accent: "from-amber-400/20 to-amber-500/5 text-amber-600" },
  { key: "report", label: "Report Issue", icon: <AlertTriangle className="w-4 h-4" />, description: "Bug or concern", accent: "from-destructive/20 to-destructive/5 text-destructive" },
  { key: "help", label: "Get Help", icon: <HelpCircle className="w-4 h-4" />, description: "Ask a question", accent: "from-sky-400/20 to-sky-500/5 text-sky-600" },
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
  const [openCategory, setOpenCategory] = useState<Category | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [suggestionType, setSuggestionType] = useState<string>("ui-ux");
  const [issueType, setIssueType] = useState<string>("bug");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [helpQuery, setHelpQuery] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setUser(session.user);
    });
  }, []);

  const resetForm = () => {
    setSubject("");
    setMessage("");
    setSuggestionType("ui-ux");
    setIssueType("bug");
    setScreenshot(null);
    setHelpQuery("");
  };

  const closeSheet = () => {
    setOpenCategory(null);
    resetForm();
  };

  const filteredFaqs = useMemo(() => {
    const q = helpQuery.trim().toLowerCase();
    if (!q) return faqItems.slice(0, 3);
    return faqItems.filter(f => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q));
  }, [helpQuery]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !openCategory || !message.trim()) return;

    setSending(true);

    const labels: Record<Category, string> = {
      message: "Admin Message",
      suggestion: `Suggestion (${suggestionType})`,
      report: `Issue Report (${issueType})`,
      help: "Help Request",
    };

    const { error } = await supabase.from("reports").insert({
      reporter_id: user.id,
      reported_type: "support",
      reported_id: user.id,
      reason: `[${labels[openCategory]}] ${subject.trim() || "No subject"}`,
      description: message.trim(),
    });

    setSending(false);

    if (error) {
      toast.error("Failed to send. Please try again.");
    } else {
      toast.success("Message sent to admin!");
      closeSheet();
    }
  };

  const activeCategory = categories.find(c => c.key === openCategory);

  return (
    <div className="h-[100dvh] max-h-[100dvh] bg-premium-page overflow-hidden flex flex-col">
      <Navbar />
      <div aria-hidden style={{ height: "calc(max(env(safe-area-inset-top), 0.25rem) + 3.5rem)" }} />
      <main
        data-allow-scroll="true"
        className="container mx-auto px-5 pt-2 pb-6 flex-1 min-h-0 overflow-hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)" }}
      >
        <div className="max-w-2xl mx-auto space-y-3 sm:space-y-5">

          <div>
            <div className="flex items-center gap-2">
              <BackButton to="/" />
              <h1 className="text-page-title text-foreground text-2xl">
                Support & Help Center
              </h1>
            </div>
            <p className="text-xs sm:text-xs text-muted-foreground mt-1 pl-12">
              Find answers, get help, or contact our team
            </p>
          </div>

          <section className="rounded-2xl border border-border bg-card px-4 py-2.5 sm:py-3">
            <h2 className="text-sm font-semibold text-foreground mb-2">Contact Us</h2>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-primary shrink-0" />
                <a href="mailto:admin@louisianahelpr.com" className="text-[11px] sm:text-xs text-primary hover:underline truncate">
                  admin@louisianahelpr.com
                </a>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary shrink-0" />
                <p className="text-[11px] sm:text-xs text-muted-foreground">Reply 24–48h</p>
              </div>
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary shrink-0" />
                <div className="flex gap-1.5 text-[11px] sm:text-xs">
                  <Link to="/terms" className="text-primary hover:underline">Terms</Link>
                  <span className="text-muted-foreground">·</span>
                  <Link to="/privacy" className="text-primary hover:underline">Privacy</Link>
                  <span className="text-muted-foreground">·</span>
                  <Link to="/rules" className="text-primary hover:underline">Rules</Link>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary shrink-0" />
                <p className="text-[11px] sm:text-xs text-muted-foreground">Helprs reviewed</p>
              </div>
            </div>
          </section>

          {user && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">Send Us a Message</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {categories.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setOpenCategory(c.key)}
                    className="rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all px-3 py-2.5 flex items-center gap-2 sm:flex-col sm:items-start sm:gap-1.5"
                  >
                    <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${c.accent} flex items-center justify-center shrink-0`}>
                      {c.icon}
                    </div>
                    <div className="text-left min-w-0">
                      <p className="font-medium text-xs text-foreground leading-tight truncate">{c.label}</p>
                      <p className="text-[10px] text-muted-foreground leading-tight truncate">{c.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2 hidden sm:block">
            <h2 className="text-sm font-semibold text-foreground">Frequently Asked Questions</h2>
            <div className="space-y-2">
              {faqItems.map((item, i) => (
                <details key={i} className="rounded-2xl border border-border bg-card group">
                  <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-foreground hover:text-primary transition-colors list-none flex items-center justify-between">
                    {item.q}
                    <span className="text-muted-foreground group-open:rotate-180 transition-transform">▾</span>
                  </summary>
                  <p className="px-4 pb-3 text-xs text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          <p className="sm:hidden text-[11px] text-center text-muted-foreground">
            Tap <span className="font-medium text-foreground">Get Help</span> above to browse FAQs
          </p>

          {!user && (
            <section className="rounded-2xl border border-border bg-card p-4 text-center space-y-3">
              <p className="text-xs text-muted-foreground">
                Sign in to send a message directly, or email us at{" "}
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

      {/* Bottom sheet for each action */}
      <Sheet open={!!openCategory} onOpenChange={(o) => !o && closeSheet()}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl border-t border-border/60 bg-background/95 backdrop-blur-xl max-h-[90vh] overflow-y-auto p-5"
        >
          {activeCategory && (
            <>
              <SheetHeader className="text-left mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${activeCategory.accent} flex items-center justify-center`}>
                    {activeCategory.icon}
                  </div>
                  <div>
                    <SheetTitle className="text-lg">{activeCategory.label}</SheetTitle>
                    <SheetDescription className="text-xs">{activeCategory.description}</SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Help: search-first */}
                {openCategory === "help" && (
                  <div className="space-y-2">
                    <Label className="text-xs">Search FAQs first</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        value={helpQuery}
                        onChange={(e) => setHelpQuery(e.target.value)}
                        placeholder="Try 'how do I post a job'…"
                        className="pl-9 rounded-xl"
                      />
                    </div>
                    {filteredFaqs.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Suggested</p>
                        {filteredFaqs.slice(0, 3).map((f, i) => (
                          <details key={i} className="rounded-xl border border-border bg-muted/30">
                            <summary className="px-3 py-2 text-xs font-medium cursor-pointer list-none flex items-center justify-between">
                              {f.q}
                              <span className="text-muted-foreground text-[10px]">▾</span>
                            </summary>
                            <p className="px-3 pb-2 text-xs text-muted-foreground">{f.a}</p>
                          </details>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Suggestion: category dropdown */}
                {openCategory === "suggestion" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Category</Label>
                    <Select value={suggestionType} onValueChange={setSuggestionType}>
                      <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ui-ux">UI / UX</SelectItem>
                        <SelectItem value="new-features">New Features</SelectItem>
                        <SelectItem value="general">General</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Report: issue type + screenshot */}
                {openCategory === "report" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Type of Issue</Label>
                      <Select value={issueType} onValueChange={setIssueType}>
                        <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bug">Bug / Crash</SelectItem>
                          <SelectItem value="payment">Payment Issue</SelectItem>
                          <SelectItem value="user">User Behavior</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Screenshot (optional)</Label>
                      <label className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-3 py-2.5 cursor-pointer hover:border-primary/40 transition">
                        <Upload className="w-4 h-4 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground truncate flex-1">
                          {screenshot ? screenshot.name : "Tap to upload an image"}
                        </span>
                        {screenshot && (
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); setScreenshot(null); }}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => setScreenshot(e.target.files?.[0] || null)}
                        />
                      </label>
                    </div>
                  </>
                )}

                {openCategory !== "help" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="subject" className="text-xs">Subject (optional)</Label>
                    <Input
                      id="subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Brief summary…"
                      className="rounded-xl"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="message" className="text-xs">
                    {openCategory === "suggestion" ? "Share your idea *" : "Your message *"}
                  </Label>
                  <Textarea
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={
                      openCategory === "suggestion" ? "What would make Helpr better?" :
                      openCategory === "report" ? "Describe what happened…" :
                      openCategory === "help" ? "Still need help? Send us your question…" :
                      "Type your message…"
                    }
                    rows={4}
                    required
                    className="rounded-xl resize-none"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full rounded-xl bg-gradient-to-r from-primary to-primary/85 shadow-md"
                  disabled={sending || !message.trim()}
                >
                  {sending ? "Sending…" : (
                    <>
                      <Send className="w-4 h-4 mr-2" /> Send Message
                    </>
                  )}
                </Button>
              </form>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default SupportPage;
