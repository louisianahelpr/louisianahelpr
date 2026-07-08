import { useState } from "react";
import BusinessNoAccountState from "@/components/business/BusinessNoAccountState";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import BusinessLayout from "@/components/business/BusinessLayout";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useMyBusiness } from "@/hooks/useMyBusiness";
import { formatJobDate } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { KeyRound, Webhook, Trash2, Copy, Eye, EyeOff, Plus, Loader2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { toast } from "sonner";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";

const WEBHOOK_EVENTS = [
  { id: "job.created", label: "Job created" },
  { id: "job.completed", label: "Job completed" },
  { id: "helper.applied", label: "Helper applied" },
];

interface ApiKey {
  id: string;
  name: string;
  key_last4: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface WebhookRow {
  id: string;
  url: string;
  events: string[] | null;
  active: boolean;
  last_delivery_at: string | null;
  last_delivery_status: string | null;
  created_at: string;
}

// Narrow a thrown value to a Supabase/Postgrest-shaped error so we can read
// its `code` without resorting to `any`.
const isPostgrestError = (e: unknown): e is { code?: string; message?: string } =>
  typeof e === "object" && e !== null && "code" in e;

const fmtDate = (s: string | null): string => (s ? formatJobDate(s) : "Never");

const BusinessApi = () => {
  usePageTitle("API & Webhooks — Helpr Business");
  const queryClient = useQueryClient();
  const { business, isLoading: bizLoading } = useMyBusiness();

  const businessId = business?.business_id;
  const isOwner = business?.is_owner;

  // ── API keys ──
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKeyPlain, setNewKeyPlain] = useState<string | null>(null);
  const [showPlain, setShowPlain] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);

  // ── Webhook ──
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<string[]>(["job.created"]);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [deletingWebhookId, setDeletingWebhookId] = useState<string | null>(null);

  const {
    data: apiKeys = [],
    isLoading: keysLoading,
    isError: keysError,
    refetch: refetchKeys,
  } = useQuery({
    queryKey: queryKeys.business.apiKeys(businessId),
    enabled: !!businessId,
    queryFn: async () => {
      // business_api_keys not yet in generated types → untyped builder.
      const { data, error } = await (supabase.from as any)("business_api_keys")
        .select("id, name, key_last4, last_used_at, created_at, revoked_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      // PGRST204/relation-missing means migration hasn't shipped yet —
      // surface an empty list instead of a screen-breaking error.
      if (error && (error.code === "PGRST204" || error.code === "42P01")) return [];
      if (error) throw error;
      return (data ?? []) as ApiKey[];
    },
  });

  const {
    data: webhooks = [],
    isError: webhooksError,
    refetch: refetchWebhooks,
  } = useQuery({
    queryKey: queryKeys.business.webhooks(businessId),
    enabled: !!businessId,
    queryFn: async () => {
      // business_webhooks not yet in generated types → untyped builder.
      const { data, error } = await (supabase.from as any)("business_webhooks")
        .select("id, url, events, active, last_delivery_at, last_delivery_status, created_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (error && (error.code === "PGRST204" || error.code === "42P01")) return [];
      if (error) throw error;
      return (data ?? []) as WebhookRow[];
    },
  });

  if (bizLoading) {
    return (
      <BusinessLayout eyebrow="Developer" title="API & Webhooks">
        <div className="flex items-center justify-center py-12"><HelprSpinner size={32} /></div>
      </BusinessLayout>
    );
  }
  if (!business) return <BusinessNoAccountState title="API & Webhooks" />;
  if (!isOwner) {
    return (
      <BusinessLayout eyebrow="Developer" title="API & Webhooks">
        <Card className="p-6">
          <p className="text-ds-13 text-muted-foreground">Only the business owner can manage API keys and webhooks.</p>
        </Card>
      </BusinessLayout>
    );
  }

  const createKey = async () => {
    if (!newKeyName.trim() || !businessId) return;
    setCreating(true);
    try {
      // create_business_api_key RPC not yet in generated types → untyped call.
      const { data, error } = await (supabase.rpc as any)("create_business_api_key", {
        _business_id: businessId,
        _name: newKeyName.trim(),
      });
      if (error) throw error;
      const plain = (data as { plaintext?: string } | null)?.plaintext;
      if (!plain) throw new Error("Server did not return the new key");
      setNewKeyPlain(plain);
      setShowPlain(true);
      setNewKeyName("");
      hapticSuccess();
      toast.success("API key created");
      queryClient.invalidateQueries({ queryKey: queryKeys.business.apiKeys(businessId) });
    } catch (err: unknown) {
      hapticError();
      const code = isPostgrestError(err) ? err.code : undefined;
      if (code === "PGRST202") {
        toast.error("API key generator not yet deployed — run `supabase db push`.");
      } else {
        toast.error(err instanceof Error ? err.message : "We couldn't create that key — try again in a moment.");
      }
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async () => {
    if (!revokeTarget) return;
    try {
      const { error } = await (supabase.from as any)("business_api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", revokeTarget.id);
      if (error) throw error;
      hapticSuccess();
      toast.success("Key revoked");
      queryClient.invalidateQueries({ queryKey: queryKeys.business.apiKeys(businessId) });
      setRevokeTarget(null);
    } catch (err: unknown) {
      hapticError();
      toast.error(err instanceof Error ? err.message : "We couldn't revoke that key — try again.");
    }
  };

  const copyKey = async (plain: string) => {
    try {
      await navigator.clipboard.writeText(plain);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy — long-press the key to copy manually.");
    }
  };

  const saveWebhook = async () => {
    if (!webhookUrl.trim() || !businessId) return;
    try {
      new URL(webhookUrl.trim());
    } catch {
      toast.error("Enter a valid HTTPS URL.");
      return;
    }
    setSavingWebhook(true);
    try {
      const secret = `whsec_${crypto.randomUUID().replace(/-/g, "")}`;
      const { error } = await (supabase.from as any)("business_webhooks").insert({
        business_id: businessId,
        url: webhookUrl.trim(),
        secret,
        events: webhookEvents,
        active: true,
      });
      if (error) throw error;
      setWebhookUrl("");
      setWebhookEvents(["job.created"]);
      hapticSuccess();
      toast.success("Webhook saved");
      queryClient.invalidateQueries({ queryKey: queryKeys.business.webhooks(businessId) });
    } catch (err: unknown) {
      hapticError();
      toast.error(err instanceof Error ? err.message : "We couldn't save that webhook — try again.");
    } finally {
      setSavingWebhook(false);
    }
  };

  const toggleWebhook = async (row: WebhookRow) => {
    try {
      const { error } = await (supabase.from as any)("business_webhooks")
        .update({ active: !row.active })
        .eq("id", row.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: queryKeys.business.webhooks(businessId) });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Couldn't update webhook.");
    }
  };

  const deleteWebhook = async (id: string) => {
    setDeletingWebhookId(id);
    try {
      const { error } = await (supabase.from as any)("business_webhooks")
        .delete()
        .eq("id", id);
      if (error) throw error;
      hapticSuccess();
      queryClient.invalidateQueries({ queryKey: queryKeys.business.webhooks(businessId) });
    } catch (err: unknown) {
      hapticError();
      toast.error(err instanceof Error ? err.message : "Couldn't delete that webhook — try again?");
    } finally {
      setDeletingWebhookId(null);
    }
  };

  return (
    <BusinessLayout
      eyebrow="Developer"
      title="API & Webhooks"
      meta="Read-only API keys and outbound event delivery."
      requiresVerification
    >
      <Card className="p-5 mb-5">
        <h2 className="font-semibold flex items-center gap-2 mb-1">
          <KeyRound className="w-4 h-4" /> API keys
        </h2>
        <p className="text-ds-12 text-muted-foreground mb-4">
          Keys are read-only. They never expire automatically — revoke any key you no longer trust.
        </p>

        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <div className="flex-1">
            <Label htmlFor="key-name" className="sr-only">Key name</Label>
            <Input
              id="key-name"
              placeholder="Production server, CI pipeline, etc."
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              maxLength={64}
            />
          </div>
          <Button onClick={createKey} disabled={creating || !newKeyName.trim()}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" /> Generate key</>}
          </Button>
        </div>

        {newKeyPlain && (
          <div className="mb-4 p-4 rounded-ds-sm bg-primary/5 border border-primary/30">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-primary" />
              <span className="font-semibold text-ds-12">Copy this key — it won't be shown again.</span>
            </div>
            <div className="flex gap-2 items-stretch">
              <code className="flex-1 font-mono text-ds-12 px-3 py-2 rounded-ds-sm bg-background border border-border break-all">
                {showPlain ? newKeyPlain : "•".repeat(Math.min(newKeyPlain.length, 48))}
              </code>
              <Button variant="outline" size="icon" onClick={() => setShowPlain((v) => !v)} aria-label={showPlain ? "Hide key" : "Show key"}>
                {showPlain ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
              <Button variant="outline" size="icon" onClick={() => copyKey(newKeyPlain)} aria-label="Copy key">
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <button
              className="text-ds-11 text-muted-foreground mt-2 underline"
              onClick={() => { setNewKeyPlain(null); setShowPlain(false); }}
            >
              I've saved it — dismiss
            </button>
          </div>
        )}

        {keysLoading ? (
          <div className="py-6 flex justify-center"><HelprSpinner size={24} /></div>
        ) : keysError ? (
          <div className="py-2">
            <p className="text-ds-12 text-muted-foreground mb-2">Couldn't load your API keys.</p>
            <Button variant="outline" size="sm" onClick={() => refetchKeys()}>Try again</Button>
          </div>
        ) : apiKeys.length === 0 ? (
          <p className="text-ds-12 text-muted-foreground py-2">No API keys yet.</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {apiKeys.map((k) => (
              <li key={k.id} className="py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="font-semibold text-ds-13 truncate">{k.name}</span>
                    {k.revoked_at && <Badge variant="destructive" className="text-ds-10">Revoked</Badge>}
                    {!k.revoked_at && <Badge variant="secondary" className="text-ds-10">Active</Badge>}
                  </div>
                  <p className="text-ds-11 text-muted-foreground">
                    helpr_live_…{k.key_last4 ?? "????"} · Created {fmtDate(k.created_at)} · Last used {fmtDate(k.last_used_at)}
                  </p>
                </div>
                {!k.revoked_at && (
                  <Button variant="ghost" size="sm" onClick={() => setRevokeTarget(k)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-1">
          <Webhook className="w-4 h-4" /> Webhook delivery
        </h2>
        <p className="text-ds-12 text-muted-foreground mb-4">
          We POST signed JSON to your URL when these events fire.
        </p>

        <div className="space-y-3 mb-4">
          <div>
            <Label htmlFor="webhook-url">Endpoint URL</Label>
            <Input
              id="webhook-url"
              type="url"
              placeholder="https://api.your-company.com/helpr-events"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-2 block">Events</Label>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map((ev) => {
                const selected = webhookEvents.includes(ev.id);
                return (
                  <button
                    type="button"
                    key={ev.id}
                    onClick={() =>
                      setWebhookEvents((cur) =>
                        cur.includes(ev.id) ? cur.filter((x) => x !== ev.id) : [...cur, ev.id],
                      )
                    }
                    className={`px-3 h-8 rounded-ds-sm text-ds-12 font-medium transition-all duration-200 ${
                      selected
                        ? "btn-grad-primary squircle border border-[hsl(66_24%_20%)] !text-[hsl(var(--parchment))]"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    }`}
                  >
                    {ev.label}
                  </button>
                );
              })}
            </div>
          </div>
          <Button onClick={saveWebhook} disabled={savingWebhook || !webhookUrl.trim() || webhookEvents.length === 0}>
            {savingWebhook ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add webhook"}
          </Button>
        </div>

        {webhooksError ? (
          <div className="py-2">
            <p className="text-ds-12 text-muted-foreground mb-2">Couldn't load your webhooks.</p>
            <Button variant="outline" size="sm" onClick={() => refetchWebhooks()}>Try again</Button>
          </div>
        ) : webhooks.length === 0 ? (
          <p className="text-ds-12 text-muted-foreground py-2">No webhooks configured.</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {webhooks.map((w) => (
              <li key={w.id} className="py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-ds-12 truncate">{w.url}</p>
                  <p className="text-ds-11 text-muted-foreground">
                    {(w.events ?? []).join(", ") || "(no events)"} · Last delivery {fmtDate(w.last_delivery_at)}
                    {w.last_delivery_status ? ` · ${w.last_delivery_status}` : ""}
                  </p>
                </div>
                <Switch checked={w.active} onCheckedChange={() => toggleWebhook(w)} />
                <Button variant="ghost" size="sm" disabled={deletingWebhookId === w.id} aria-label="Delete webhook" onClick={() => deleteWebhook(w.id)}>
                  {deletingWebhookId === w.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <BrandConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}
        title="Revoke this key?"
        description="Any service using this key will start receiving 401 responses immediately. You can't undo a revoke."
        primaryLabel="Revoke key"
        primaryTone="bark"
        primaryHaptic="medium"
        onPrimary={revokeKey}
        secondaryLabel="Keep it"
      />
    </BusinessLayout>
  );
};

export default BusinessApi;
