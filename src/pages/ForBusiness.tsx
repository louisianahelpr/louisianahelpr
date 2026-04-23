import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Building2, CheckCircle2, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Link } from "react-router-dom";

const PARISHES = [
  "Orleans", "Jefferson", "East Baton Rouge", "Caddo", "St. Tammany",
  "Lafayette", "Calcasieu", "Ouachita", "Rapides", "Bossier", "Livingston",
  "Tangipahoa", "Ascension", "St. Bernard", "Iberia", "Terrebonne",
];

const ForBusiness = () => {
  const navigate = useNavigate();
  usePageTitle("Helpr for Business — Louisiana Commercial Services");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [parish, setParish] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !company.trim()) {
      toast.error("Email and company are required");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("hubspot-lead-capture", {
        body: {
          email: email.trim(),
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          phone: phone.trim() || undefined,
          company: company.trim(),
          parish: parish || undefined,
          message: message.trim() || undefined,
          source: "for_business_landing",
        },
      });
      if (error) throw error;
      setSubmitted(true);
      toast.success("Thanks! We'll be in touch within 1 business day.");
    } catch (err: any) {
      toast.error(err.message || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-5 py-6 max-w-5xl">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to Helpr
        </Link>

        <div className="grid lg:grid-cols-2 gap-12 items-start">
          {/* Pitch */}
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
              <Building2 className="w-3.5 h-3.5" /> For Business
            </div>
            <h1 className="text-4xl sm:text-5xl font-display font-bold leading-tight">
              Vetted Louisiana help, on demand for your business.
            </h1>
            <p className="text-lg text-muted-foreground">
              Property managers, realtors, small business owners, and commercial cleaners — get
              recurring access to background-checked local helprs without the agency markup.
            </p>

            <div className="space-y-3 pt-4">
              {[
                { icon: ShieldCheck, text: "Stripe-verified, background-screened helprs" },
                { icon: Sparkles, text: "Recurring jobs with discounted rates for repeat business" },
                { icon: CheckCircle2, text: "Single point of contact + monthly invoicing available" },
              ].map((row, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <row.icon className="w-4 h-4" />
                  </div>
                  <p className="text-sm pt-1">{row.text}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-border/60 bg-card p-5 mt-6">
              <p className="text-sm font-semibold mb-1">Who it's for</p>
              <p className="text-sm text-muted-foreground">
                Apartment turnovers · post-event cleanup · realtor staging · small office maintenance ·
                event setup · move-in/out cleans across all 64 parishes.
              </p>
            </div>
          </div>

          {/* Lead form */}
          <div className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-6 sm:p-8">
            {submitted ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-display font-bold mb-2">You're in.</h2>
                <p className="text-muted-foreground mb-6">
                  We'll email you within 1 business day to set up your business account.
                </p>
                <Button variant="outline" onClick={() => navigate("/")}>Back home</Button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div>
                  <h2 className="text-xl font-display font-bold">Talk to our team</h2>
                  <p className="text-sm text-muted-foreground">
                    Tell us about your business — we reply within 1 business day.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="first">First name</Label>
                    <Input id="first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="last">Last name</Label>
                    <Input id="last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email">Work email *</Label>
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="company">Company *</Label>
                  <Input id="company" required value={company} onChange={(e) => setCompany(e.target.value)} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Parish</Label>
                    <Select value={parish} onValueChange={setParish}>
                      <SelectTrigger><SelectValue placeholder="Pick parish" /></SelectTrigger>
                      <SelectContent>
                        {PARISHES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="msg">What do you need help with?</Label>
                  <Textarea id="msg" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Weekly turnover cleans for 12-unit complex in Mid-City" />
                </div>

                <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                  {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : "Get in touch"}
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  We'll only use your info to follow up about your business inquiry.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForBusiness;
