import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import BusinessLayout from "@/components/business/BusinessLayout";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useMyBusiness } from "@/hooks/useMyBusiness";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { safeStorage } from "@/lib/safeStorage";
import { CheckCircle2, ArrowRight, ArrowLeft as ArrowLeftIcon, Building2, Users, CreditCard, CalendarClock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess } from "@/lib/haptics";

const STORAGE_KEY = "biz_onboarding_v1";

interface State {
  step: number;
  companyName: string;
  industry: string;
  invites: string;          // comma-separated emails
  paymentMethod: "card" | "invoice";
  firstJobTitle: string;
  firstJobBudget: string;
}

const INITIAL: State = {
  step: 1,
  companyName: "",
  industry: "",
  invites: "",
  paymentMethod: "card",
  firstJobTitle: "",
  firstJobBudget: "125",
};

const STEPS = [
  { id: 1, label: "Account", icon: Building2 },
  { id: 2, label: "Team", icon: Users },
  { id: 3, label: "Payment", icon: CreditCard },
  { id: 4, label: "First job", icon: CalendarClock },
  { id: 5, label: "Done", icon: Sparkles },
];

const BusinessOnboarding = () => {
  usePageTitle("Get started — Helpr Business");
  const navigate = useNavigate();
  const { business } = useMyBusiness();
  const [state, setState] = useState<State>(() => {
    try {
      const raw = safeStorage.getItem(STORAGE_KEY);
      if (raw) return { ...INITIAL, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return INITIAL;
  });

  // Persist on each change so refresh / nav-away resumes where they left off.
  useEffect(() => {
    safeStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Already onboarded? Hop them to their existing dashboard. The route
  // is also wired as a redirect target for fresh signups (see BusinessSignupRedirect helper).
  useEffect(() => {
    if (business && state.step === 1) {
      // user already has a business but might still want to revisit the wizard
      setState((s) => ({ ...s, companyName: business.business_name }));
    }
  }, [business]);

  const pct = useMemo(() => Math.round(((state.step - 1) / (STEPS.length - 1)) * 100), [state.step]);

  const next = () => setState((s) => ({ ...s, step: Math.min(s.step + 1, STEPS.length) }));
  const back = () => setState((s) => ({ ...s, step: Math.max(s.step - 1, 1) }));

  const finish = () => {
    safeStorage.removeItem(STORAGE_KEY);
    hapticSuccess();
    toast.success("You're all set.");
    navigate("/business/team");
  };

  const stepContent = () => {
    switch (state.step) {
      case 1:
        return (
          <>
            <h2 className="font-semibold flex items-center gap-2 mb-1">
              <Building2 className="w-4 h-4" /> Tell us about your company
            </h2>
            <p className="text-ds-12 text-muted-foreground mb-4">
              Anything you set here you can change later in Team settings.
            </p>
            <div className="space-y-3">
              <div>
                <Label htmlFor="o-name">Company name</Label>
                <Input id="o-name" value={state.companyName} onChange={(e) => setState((s) => ({ ...s, companyName: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="o-industry">Industry (optional)</Label>
                <Input id="o-industry" value={state.industry} onChange={(e) => setState((s) => ({ ...s, industry: e.target.value }))} />
              </div>
            </div>
          </>
        );
      case 2:
        return (
          <>
            <h2 className="font-semibold flex items-center gap-2 mb-1">
              <Users className="w-4 h-4" /> Invite your team
            </h2>
            <p className="text-ds-12 text-muted-foreground mb-4">
              Enter one email per line. You can add more from Team settings later.
            </p>
            <Textarea
              aria-label="Team member emails, one per line"
              rows={5}
              value={state.invites}
              onChange={(e) => setState((s) => ({ ...s, invites: e.target.value }))}
            />
          </>
        );
      case 3:
        return (
          <>
            <h2 className="font-semibold flex items-center gap-2 mb-1">
              <CreditCard className="w-4 h-4" /> Payment method
            </h2>
            <p className="text-ds-12 text-muted-foreground mb-4">
              Pick what works for your AP team. You can switch any time from /business/billing.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(["card", "invoice"] as const).map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setState((s) => ({ ...s, paymentMethod: m }))}
                  className={`p-4 rounded-ds-md border text-left ${state.paymentMethod === m ? "border-primary bg-primary/5" : "border-border bg-card"}`}
                >
                  <p className="font-semibold capitalize">{m === "card" ? "Card on File" : "Invoice (Net-30)"}</p>
                  <p className="text-ds-11 text-muted-foreground mt-1">
                    {m === "card" ? "Charge a card at job post time." : "Bill monthly with 30-day terms."}
                  </p>
                </button>
              ))}
            </div>
          </>
        );
      case 4:
        return (
          <>
            <h2 className="font-semibold flex items-center gap-2 mb-1">
              <CalendarClock className="w-4 h-4" /> Stage your first job template
            </h2>
            <p className="text-ds-12 text-muted-foreground mb-4">
              We'll save this as a draft you can post from your jobs list.
            </p>
            <div className="space-y-3">
              <div>
                <Label htmlFor="o-job-title">Job title</Label>
                <Input id="o-job-title" value={state.firstJobTitle} onChange={(e) => setState((s) => ({ ...s, firstJobTitle: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="o-job-budget">Budget</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input id="o-job-budget" className="pl-7" type="number" min={0} step="1" inputMode="decimal" value={state.firstJobBudget} onChange={(e) => setState((s) => ({ ...s, firstJobBudget: e.target.value }))} />
                </div>
              </div>
            </div>
          </>
        );
      case 5:
      default:
        return (
          <div className="text-center py-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-primary/15 text-primary flex items-center justify-center mb-3">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="font-semibold text-ds-17 mb-2">You're set up!</h2>
            <p className="text-ds-12 text-muted-foreground">
              Your team is invited, billing is configured, and your first job template is staged. Hop into Team to start.
            </p>
          </div>
        );
    }
  };

  return (
    <BusinessLayout eyebrow="Onboarding" title="Get started" meta="Five quick steps. We save as you go.">
      <Card className="p-5 mb-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-ds-12 text-muted-foreground">Step {state.step} of {STEPS.length}</p>
          <p className="text-ds-12 font-semibold">{pct}%</p>
        </div>
        {/* A <Progress> with no accessible name announces only a percentage,
            so a screen-reader user hears a number with nothing to attach it to
            (axe: aria-progressbar-name). */}
        <Progress value={pct} aria-label="Business onboarding progress" />
        <div className="flex justify-between mt-3 -mx-1">
          {STEPS.map((s) => {
            const Icon = s.icon;
            const done = state.step > s.id;
            const active = state.step === s.id;
            return (
              <div key={s.id} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
                  done ? "btn-grad-primary !text-[hsl(var(--parchment))] [&_svg]:!text-[hsl(var(--parchment))]" : active ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
                }`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <span className={`text-ds-10 truncate ${active ? "text-foreground font-semibold" : "text-muted-foreground"}`}>{s.label}</span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-5 mb-5">
        {stepContent()}
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={back} disabled={state.step === 1}>
          <ArrowLeftIcon className="w-4 h-4 mr-1" /> Back
        </Button>
        {state.step < STEPS.length ? (
          <Button onClick={next}>
            Next <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={finish}>Take Me to My Team</Button>
        )}
      </div>
    </BusinessLayout>
  );
};

export default BusinessOnboarding;
