import { ShieldCheck, Lock, FileText } from "lucide-react";

export function ComplianceSection() {
  return (
    <section
      aria-labelledby="compliance-heading"
      className="liquid-glass p-6 lg:p-7"
    >
      <div className="flex items-center gap-3 mb-5">
        <div
          className="w-10 h-10 rounded-ds-md flex items-center justify-center shrink-0"
          style={{
            background: "hsl(var(--bark) / 0.08)",
            color: "hsl(var(--bark))",
          }}
        >
          <ShieldCheck className="w-5 h-5" strokeWidth={1.75} />
        </div>
        <div>
          <span className="text-display-eyebrow">Compliance &amp; procurement</span>
          <h2
            id="compliance-heading"
            className="font-display italic font-bold leading-tight"
            style={{
              fontSize: "clamp(1.35rem, 2vw + 0.5rem, 1.75rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            What your back office needs.
          </h2>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div
          className="rounded-ds-md p-4"
          style={{ background: "hsl(var(--bark) / 0.04)", border: "1px solid hsl(var(--olivewood) / 0.12)" }}
        >
          <p className="text-ds-13 font-semibold mb-2" style={{ color: "hsl(var(--ink-deep))" }}>
            Identity verification
          </p>
          <p className="text-ds-11 text-muted-foreground leading-relaxed">
            Every Helpr submits a{" "}
            <span className="font-semibold text-foreground">government-issued ID</span>{" "}
            through Stripe and is reviewed by our team before being activated on the platform.
          </p>
        </div>

        <div
          className="rounded-ds-md p-4"
          style={{ background: "hsl(var(--bark) / 0.04)", border: "1px solid hsl(var(--olivewood) / 0.12)" }}
        >
          <p className="text-ds-13 font-semibold mb-2 flex items-center gap-1.5" style={{ color: "hsl(var(--ink-deep))" }}>
            <Lock className="w-4 h-4" strokeWidth={1.75} />
            Funds held until work is confirmed
          </p>
          <p className="text-ds-11 text-muted-foreground leading-relaxed">
            Payments are held in{" "}
            <span className="font-semibold text-foreground">a secure hold</span>{" "}
            until your team confirms the work is complete. No pay-before-you-see issues.
          </p>
        </div>

        <div
          className="rounded-ds-md p-4"
          style={{ background: "hsl(var(--bark) / 0.04)", border: "1px solid hsl(var(--olivewood) / 0.12)" }}
        >
          <p className="text-ds-13 font-semibold mb-2 flex items-center gap-1.5" style={{ color: "hsl(var(--ink-deep))" }}>
            <FileText className="w-4 h-4" strokeWidth={1.75} />
            W-9 / 1099 handling
          </p>
          <p className="text-ds-11 text-muted-foreground leading-relaxed">
            We collect contractor W-9s and handle{" "}
            <span className="font-semibold text-foreground">1099-K reporting</span>{" "}
            through Stripe, so your AP team doesn't have to chase paperwork.
          </p>
        </div>
      </div>
    </section>
  );
}

export default ComplianceSection;
