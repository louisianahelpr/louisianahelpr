import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BanknoteIcon, CreditCard, CheckCircle, AlertCircle, Loader2, Trash2, Plus, Building2, Pencil,
} from "lucide-react";
import { toast } from "sonner";

type PayoutMethod = {
  id: string;
  type: string;
  last4: string;
  bank_name: string | null;
  brand: string | null;
  default_for_currency: boolean;
};

type FormMode = "none" | "bank" | "card";

export function PayoutSetupForm() {
  const [methods, setMethods] = useState<PayoutMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [formMode, setFormMode] = useState<FormMode>("none");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Bank form
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [confirmAccountNumber, setConfirmAccountNumber] = useState("");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [ssnLast4, setSsnLast4] = useState("");

  useEffect(() => {
    loadMethods();
  }, []);

  const loadMethods = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "list_payout_methods" },
      });
      if (error) throw error;
      setMethods(data?.methods || []);
    } catch (err: any) {
      console.error("Failed to load payout methods:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddBank = async () => {
    if (!routingNumber || !accountNumber || !accountHolderName || !ssnLast4) {
      toast.error("Please fill in all fields");
      return;
    }
    if (routingNumber.length !== 9) {
      toast.error("Routing number must be 9 digits");
      return;
    }
    if (ssnLast4.length !== 4) {
      toast.error("Please enter the last 4 digits of your SSN");
      return;
    }
    if (accountNumber !== confirmAccountNumber) {
      toast.error("Account numbers don't match");
      return;
    }

    setSaving(true);
    try {
      // First ensure account exists with SSN
      await supabase.functions.invoke("stripe-connect", {
        body: { action: "onboard", ssn_last_4: ssnLast4 },
      });

      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: {
          action: "add_bank",
          routing_number: routingNumber,
          account_number: accountNumber,
          account_holder_name: accountHolderName,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Bank account ending in ${data.bank_last4} added!`);
      resetForm();
      loadMethods();
    } catch (err: any) {
      toast.error(err.message || "Failed to add bank account");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMethod = async (methodId: string) => {
    setDeleting(methodId);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "delete_payout_method", method_id: methodId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Payout method removed");
      loadMethods();
    } catch (err: any) {
      toast.error(err.message || "Failed to remove method");
    } finally {
      setDeleting(null);
    }
  };

  const resetForm = () => {
    setFormMode("none");
    setRoutingNumber("");
    setAccountNumber("");
    setConfirmAccountNumber("");
    setAccountHolderName("");
    setSsnLast4("");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading payout methods…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Existing methods */}
      {methods.length > 0 && (
        <div className="space-y-2">
          {methods.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-3">
                {m.type === "bank_account" ? (
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                    <CreditCard className="w-5 h-5 text-accent-foreground" />
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {m.type === "bank_account"
                      ? `${m.bank_name || "Bank"} ····${m.last4}`
                      : `${m.brand || "Card"} ····${m.last4}`}
                  </p>
                  {m.default_for_currency && (
                    <span className="text-xs text-primary font-medium flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Default
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDeleteMethod(m.id)}
                disabled={deleting === m.id}
                className="text-muted-foreground hover:text-destructive"
              >
                {deleting === m.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* No methods prompt */}
      {methods.length === 0 && formMode === "none" && (
        <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">No payout method connected</p>
              <p className="text-xs text-muted-foreground mt-1">
                Add a bank account or debit card to receive payouts for completed jobs.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Add method buttons */}
      {formMode === "none" && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setFormMode("bank")} className="h-auto py-3 flex-col gap-1">
            <Building2 className="w-5 h-5 text-primary" />
            <span className="text-xs">Bank Account</span>
          </Button>
          <Button variant="outline" onClick={() => setFormMode("card")} className="h-auto py-3 flex-col gap-1">
            <CreditCard className="w-5 h-5 text-primary" />
            <span className="text-xs">Debit Card</span>
          </Button>
        </div>
      )}

      {/* Bank Account Form */}
      {formMode === "bank" && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" /> Add Bank Account
            </h3>
            <Button variant="ghost" size="sm" onClick={resetForm} className="text-xs text-muted-foreground">
              Cancel
            </Button>
          </div>

          <div className="space-y-3">
            <div>
              <Label htmlFor="holder-name" className="text-xs">Account holder name</Label>
              <Input
                id="holder-name"
                value={accountHolderName}
                onChange={(e) => setAccountHolderName(e.target.value)}
                placeholder="Full legal name"
              />
            </div>
            <div>
              <Label htmlFor="routing" className="text-xs">Routing number</Label>
              <Input
                id="routing"
                value={routingNumber}
                onChange={(e) => setRoutingNumber(e.target.value.replace(/\D/g, "").slice(0, 9))}
                placeholder="9-digit routing number"
                inputMode="numeric"
              />
            </div>
            <div>
              <Label htmlFor="account" className="text-xs">Account number</Label>
              <Input
                id="account"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
                placeholder="Account number"
                inputMode="numeric"
              />
            </div>
            <div>
              <Label htmlFor="confirm-account" className="text-xs">Confirm account number</Label>
              <Input
                id="confirm-account"
                value={confirmAccountNumber}
                onChange={(e) => setConfirmAccountNumber(e.target.value.replace(/\D/g, ""))}
                placeholder="Re-enter account number"
                inputMode="numeric"
              />
            </div>
            <div>
              <Label htmlFor="ssn-last4" className="text-xs">Last 4 digits of SSN</Label>
              <Input
                id="ssn-last4"
                value={ssnLast4}
                onChange={(e) => setSsnLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="••••"
                inputMode="numeric"
                maxLength={4}
                type="password"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Required by Stripe to verify your identity and enable payouts.</p>
            </div>
          </div>

          <Button onClick={handleAddBank} disabled={saving} className="w-full">
            {saving ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Adding…</>
            ) : (
              <><Plus className="w-4 h-4 mr-2" /> Add bank account</>
            )}
          </Button>

          <p className="text-[11px] text-muted-foreground text-center">
            Your banking info is sent directly to Stripe and never stored on our servers.
          </p>
        </div>
      )}

      {/* Debit Card Form — placeholder since tokenization requires Stripe.js */}
      {formMode === "card" && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary" /> Add Debit Card
            </h3>
            <Button variant="ghost" size="sm" onClick={resetForm} className="text-xs text-muted-foreground">
              Cancel
            </Button>
          </div>
          <div className="rounded-lg bg-secondary/30 p-4 text-center space-y-2">
            <CreditCard className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">
              Debit card payouts coming soon! For now, please add a bank account.
            </p>
          </div>
          <Button variant="outline" onClick={() => setFormMode("bank")} className="w-full">
            Add bank account instead
          </Button>
        </div>
      )}

      {/* Success state */}
      {methods.length > 0 && (
        <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-primary shrink-0" />
            <p className="text-xs text-muted-foreground">
              Payouts will be automatically sent to your default method when jobs are completed.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
