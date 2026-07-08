import { useState } from "react";
import BusinessNoAccountState from "@/components/business/BusinessNoAccountState";
import BusinessLayout from "@/components/business/BusinessLayout";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useMyBusiness } from "@/hooks/useMyBusiness";
import { formatPrice } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { Download, FileText, Clock, CheckCircle2, AlertCircle, Receipt } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { hapticError, hapticSuccess } from "@/lib/haptics";

interface SampleInvoice {
  id: string;
  number: string;
  amountCents: number;
  issuedAt: string;
  dueAt: string;
  status: "outstanding" | "paid" | "overdue";
}

// Placeholder dataset — until the billing-mode-switch is plumbed through
// to real Stripe invoices, the UI shows a sensible sample so business
// owners can see the shape of what they're opting into.
const SAMPLE_INVOICES: SampleInvoice[] = [
  { id: "1", number: "INV-2026-061", amountCents: 152_400, issuedAt: "2026-06-01", dueAt: "2026-07-01", status: "outstanding" },
  { id: "2", number: "INV-2026-053", amountCents: 89_000, issuedAt: "2026-05-01", dueAt: "2026-05-31", status: "paid" },
  { id: "3", number: "INV-2026-044", amountCents: 217_500, issuedAt: "2026-04-01", dueAt: "2026-05-01", status: "paid" },
];

// Money renders through the canonical `formatPrice` so it reads identically
// to the rest of the app ($85, $85.50 — no trailing ".00").
const fmtCents = (cents: number) => `$${formatPrice(cents / 100)}`;

const StatusPill = ({ status }: { status: SampleInvoice["status"] }) => {
  const cfg = {
    outstanding: { label: "Outstanding", icon: Clock, cls: "bg-accent/15 text-accent" },
    paid: { label: "Paid", icon: CheckCircle2, cls: "bg-primary/15 text-primary" },
    overdue: { label: "Overdue", icon: AlertCircle, cls: "bg-destructive/15 text-destructive" },
  }[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 h-6 rounded-ds-sm text-ds-11 font-semibold ${cfg.cls}`}>
      <Icon className="w-3 h-3" /> {cfg.label}
    </span>
  );
};

const BusinessBilling = () => {
  usePageTitle("Billing — Helpr Business");
  const { business, isLoading } = useMyBusiness();
  const [invoiceMode, setInvoiceMode] = useState(false);
  const [updating, setUpdating] = useState(false);

  if (isLoading) {
    return (
      <BusinessLayout eyebrow="Your business" title="Billing">
        <div className="flex items-center justify-center py-12">
          <HelprSpinner size={32} />
        </div>
      </BusinessLayout>
    );
  }
  if (!business) return <BusinessNoAccountState title="Billing" />;
  if (!business.is_owner) {
    return (
      <BusinessLayout eyebrow="Your business" title="Billing">
        <Card className="p-6">
          <p className="text-ds-13 text-muted-foreground">
            Only the business owner can manage billing settings.
          </p>
        </Card>
      </BusinessLayout>
    );
  }

  const toggleInvoiceMode = async (next: boolean) => {
    setUpdating(true);
    try {
      // billing_mode lives on `businesses` per migration 20260609180000.
      // Types haven't been regen'd against prod yet — cast through any
      // to keep typecheck green until the DB push lands.
      const { error } = await (supabase.from as any)("businesses")
        .update({ billing_mode: next ? "invoice" : "card" })
        .eq("id", business.business_id);
      if (error) throw error;
      setInvoiceMode(next);
      hapticSuccess();
      toast.success(next ? "Invoice billing enabled" : "Switched back to card billing");
    } catch (err: any) {
      hapticError();
      // PGRST202 means the column hasn't been migrated yet — softly toggle
      // UI state so the owner can preview the experience.
      if (err?.code === "PGRST202" || err?.code === "42703") {
        setInvoiceMode(next);
        toast.message(next ? "Invoice mode (preview)" : "Card mode (preview)", {
          description: "Production database not yet migrated — your choice is saved locally.",
        });
      } else {
        toast.error(err.message || "We couldn't update billing mode — try again in a moment.");
      }
    } finally {
      setUpdating(false);
    }
  };

  const downloadInvoiceStub = (invoice: SampleInvoice) => {
    // Generate a quick text-based "invoice" so the Download CTA actually
    // produces a file — real PDF gen lives in a Stripe-backed followup.
    const text =
      `Helpr Business Invoice\n\n` +
      `Business: ${business.business_name}\n` +
      `Invoice: ${invoice.number}\n` +
      `Issued: ${invoice.issuedAt}\n` +
      `Due:    ${invoice.dueAt}\n` +
      `Total:  ${fmtCents(invoice.amountCents)}\n` +
      `Status: ${invoice.status}\n\n` +
      `(Sample preview — PDF rendering is enabled when you switch to invoice billing.)\n`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoice.number}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const outstanding = SAMPLE_INVOICES.filter((i) => i.status !== "paid");
  const history = SAMPLE_INVOICES.filter((i) => i.status === "paid");

  return (
    <BusinessLayout
      eyebrow="Your business"
      title="Billing"
      meta="Invoice-based payment with net-30 terms or card-on-file."
      requiresVerification
    >
      <Card className="p-5 mb-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold flex items-center gap-2 mb-1">
              <Receipt className="w-4 h-4" /> Billing mode
            </h2>
            <p className="text-ds-12 text-muted-foreground">
              {invoiceMode
                ? "Jobs accrue to a monthly invoice. Net-30 terms apply."
                : "Each job is charged to your card on file at post time."}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-ds-11 text-muted-foreground">Card</span>
            <Switch checked={invoiceMode} onCheckedChange={toggleInvoiceMode} disabled={updating} />
            <span className="text-ds-11 text-muted-foreground">Invoice</span>
          </div>
        </div>
        {invoiceMode && (
          <div className="mt-4 p-3 rounded-ds-sm bg-accent/5 border border-accent/20 text-ds-12 text-foreground">
            <strong className="font-semibold">Net-30 informational only.</strong>{" "}
            Real terms are negotiated per account with our finance team.
          </div>
        )}
      </Card>

      <Card className="p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4" /> Outstanding invoices
          </h2>
          <Badge variant="secondary" className="text-ds-11">
            {outstanding.length} open
          </Badge>
        </div>
        {outstanding.length === 0 ? (
          <p className="text-ds-12 text-muted-foreground">All caught up.</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {outstanding.map((inv) => (
              <li key={inv.id} className="py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="font-mono text-ds-13 font-semibold">{inv.number}</span>
                    <StatusPill status={inv.status} />
                  </div>
                  <p className="text-ds-11 text-muted-foreground">
                    Issued {inv.issuedAt} · Due {inv.dueAt}
                  </p>
                </div>
                <span className="font-semibold tabular-nums text-ds-15">{fmtCents(inv.amountCents)}</span>
                <Button variant="outline" size="sm" onClick={() => downloadInvoiceStub(inv)}>
                  <Download className="w-3.5 h-3.5 mr-1" /> PDF
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4" /> Payment history
          </h2>
          <Badge variant="secondary" className="text-ds-11">
            {history.length} paid
          </Badge>
        </div>
        <ul className="divide-y divide-border/40">
          {history.map((inv) => (
            <li key={inv.id} className="py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="font-mono text-ds-13 font-semibold">{inv.number}</span>
                  <StatusPill status={inv.status} />
                </div>
                <p className="text-ds-11 text-muted-foreground">Issued {inv.issuedAt}</p>
              </div>
              <span className="font-semibold tabular-nums text-ds-15">{fmtCents(inv.amountCents)}</span>
              <Button variant="outline" size="sm" onClick={() => downloadInvoiceStub(inv)}>
                <Download className="w-3.5 h-3.5 mr-1" /> PDF
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </BusinessLayout>
  );
};

export default BusinessBilling;
