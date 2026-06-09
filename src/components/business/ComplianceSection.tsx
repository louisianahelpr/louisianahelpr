import { ShieldCheck, FileCheck2, Mail } from "lucide-react";

/**
 * Compliance disclosure block — surfaces background-check tier, insurance
 * limit, and Certificate of Insurance request path. Procurement teams
 * routinely ask for these three before a vendor can be approved.
 */
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
            Background-check tier
          </p>
          <p className="text-ds-11 text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Tier 2:</span>{" "}
            county + federal criminal, SSN trace, and sex-offender registry
            run by our verification partner before activation.
          </p>
        </div>

        <div
          className="rounded-ds-md p-4"
          style={{ background: "hsl(var(--bark) / 0.04)", border: "1px solid hsl(var(--olivewood) / 0.12)" }}
        >
          <p className="text-ds-13 font-semibold mb-2" style={{ color: "hsl(var(--ink-deep))" }}>
            Insurance coverage
          </p>
          <p className="text-ds-11 text-muted-foreground leading-relaxed">
            Up to{" "}
            <span className="font-semibold text-foreground">
              $1,000,000 per task
            </span>{" "}
            in general liability through our underwriter. Covers
            property damage and bodily injury on the jobsite.
          </p>
        </div>

        <div
          className="rounded-ds-md p-4"
          style={{ background: "hsl(var(--bark) / 0.04)", border: "1px solid hsl(var(--olivewood) / 0.12)" }}
        >
          <p className="text-ds-13 font-semibold mb-2 flex items-center gap-1.5" style={{ color: "hsl(var(--ink-deep))" }}>
            <FileCheck2 className="w-4 h-4" strokeWidth={1.75} />
            Need a COI?
          </p>
          <p className="text-ds-11 text-muted-foreground leading-relaxed">
            We issue Certificates of Insurance for property managers,
            landlords, and procurement on request.
          </p>
          <a
            href="mailto:request@louisianahelpr.com?subject=Certificate%20of%20Insurance%20Request"
            className="inline-flex items-center gap-1.5 text-ds-11 font-semibold mt-2 hover:underline"
            style={{ color: "hsl(var(--bark))" }}
          >
            <Mail className="w-3.5 h-3.5" strokeWidth={2} />
            request@louisianahelpr.com
          </a>
        </div>
      </div>
    </section>
  );
}

export default ComplianceSection;
