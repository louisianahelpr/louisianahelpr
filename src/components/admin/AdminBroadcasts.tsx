import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Megaphone, Plus, Trash2, Loader2, X } from "lucide-react";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { toneTextClasses } from "@/components/admin/tones";
import { cn } from "@/lib/utils";

interface Broadcast {
  id: string;
  title: string;
  message: string;
  type: string;
  starts_at: string;
  expires_at: string;
  created_at: string;
  pending_push_fan_out_at: string | null;
  push_fanned_out_at: string | null;
}

const BROADCASTS_KEY = ["admin", "broadcasts"] as const;

const AdminBroadcasts = () => {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  // Re-rendered every second so the countdown stays live without us
  // owning the canonical timer. Source of truth is pending_push_fan_out_at.
  const [, setNowTick] = useState(0);

  // Form
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState("info");
  const [duration, setDuration] = useState("24"); // hours
  const [showForm, setShowForm] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // unwrap() in queryFn surfaces failures into isError so the UI shows a
  // recoverable <ErrorState/> rather than silently swallowing into an
  // empty list (per CLAUDE.md "Never drop the Supabase `error`" rule).
  const {
    data: broadcasts = [],
    isLoading,
    isError,
    refetch,
    // 15s refetch keeps push_fanned_out_at fresh after the cron sweep —
    // the prior implementation used a manual setInterval.
  } = useQuery<Broadcast[]>({
    queryKey: BROADCASTS_KEY,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("broadcast_messages")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(20),
      ) as Broadcast[],
    refetchInterval: 15_000,
  });

  // Single in-window broadcast: the most recent row whose push hasn't
  // fanned out yet. Server-side state — survives tab close, refresh,
  // and network drop. The pg_cron sweeper fires the push at the target
  // time regardless of whether this tab is open.
  const pending = broadcasts.find(
    (b) => b.pending_push_fan_out_at !== null && b.push_fanned_out_at === null,
  );

  // 1Hz tick to keep the countdown label fresh while a pending row exists.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [pending]);

  const secondsLeft = pending
    ? Math.max(0, Math.ceil((new Date(pending.pending_push_fan_out_at!).getTime() - Date.now()) / 1000))
    : 0;

  const cancelPending = async () => {
    if (!pending) return;
    // Clear the pending stamp so the sweeper skips it; expire the banner
    // so it disappears from users' surfaces immediately.
    const { error } = await supabase
      .from("broadcast_messages")
      .update({ pending_push_fan_out_at: null, expires_at: new Date().toISOString() })
      .eq("id", pending.id);
    if (error) {
      report(error, { tags: { source: "AdminBroadcasts.cancelPending" } });
      toast.error(`Couldn't cancel: ${error.message}`);
      return;
    }
    toast.success("Broadcast cancelled — no push will go out.");
    qc.invalidateQueries({ queryKey: BROADCASTS_KEY });
  };

  const create = async () => {
    if (!title.trim() || !message.trim()) {
      toast.error("Title and message are required.");
      return;
    }
    if (pending) {
      toast.error("A broadcast is in the undo window. Wait or cancel it first.");
      return;
    }
    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setCreating(false);
      return;
    }

    const expiresAt = new Date(Date.now() + parseInt(duration) * 60 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from("broadcast_messages")
      .insert({
        title: title.trim(),
        message: message.trim(),
        type,
        created_by: user.id,
        expires_at: expiresAt,
      });

    setCreating(false);
    if (error) {
      // Rate-limit error from the BEFORE INSERT trigger has a clear
      // human message; surface it directly.
      report(error, { tags: { source: "AdminBroadcasts.create" } });
      toast.error(error.message);
      return;
    }

    toast.info("Broadcast posted. Push fires in ~30s — cancel from the banner if there's a typo.");
    setTitle("");
    setMessage("");
    setType("info");
    setDuration("24");
    setShowForm(false);
    qc.invalidateQueries({ queryKey: BROADCASTS_KEY });
  };

  const remove = async (id: string) => {
    setDeleting(true);
    const { error } = await supabase.from("broadcast_messages").delete().eq("id", id);
    setDeleting(false);
    if (error) {
      report(error, { tags: { source: "AdminBroadcasts.remove" } });
      toast.error("Couldn't remove that broadcast — try again.");
      return;
    }
    qc.setQueryData<Broadcast[]>(BROADCASTS_KEY, (prev) =>
      (prev ?? []).filter((b) => b.id !== id),
    );
    setConfirmDeleteId(null);
    toast.success("Broadcast removed");
  };

  const isActive = (b: Broadcast) => {
    const now = new Date();
    return new Date(b.starts_at) <= now && new Date(b.expires_at) > now;
  };

  const typeBadge: Record<string, string> = {
    info: "bg-primary/10 text-primary",
    warning: "bg-accent/10 text-accent",
    urgent: "bg-destructive/10 text-destructive",
    promo: "bg-primary/10 text-primary",
  };

  return (
    <div className="space-y-6">
      {/* Undo countdown banner — server-driven. Visible whenever
          pending_push_fan_out_at is set and push_fanned_out_at is not.
          Survives tab close: pg_cron runs the fan-out regardless. */}
      {pending && (
        <div className={cn("rounded-ds-md border border-warning/40 bg-warning/10 p-4 flex items-center justify-between gap-3", toneTextClasses.warning)}>
          <div>
            <p className="text-ds-13 font-semibold">
              Push fires in ~{secondsLeft}s
            </p>
            <p className="text-ds-11 opacity-80">
              Banner is already visible to users. Cancel within the window
              to retract the broadcast and skip the push.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={cancelPending}
            className={cn("border-warning/60 hover:bg-warning/20 shrink-0", toneTextClasses.warning)}
          >
            <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
          </Button>
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setShowForm(!showForm)} className="gap-1">
          <Plus className="w-3.5 h-3.5" /> New Broadcast
        </Button>
      </div>

      {showForm && (
        <div className="rounded-ds-md liquid-glass p-4 space-y-3">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input aria-label="Broadcast title" value={title} onChange={e => setTitle(e.target.value)} maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea aria-label="Broadcast message" value={message} onChange={e => setMessage(e.target.value)} placeholder="We'll be performing maintenance tonight from 10pm-12am CST." rows={2} maxLength={500} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="broadcast-type">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="broadcast-type" aria-label="Broadcast type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="promo">Promo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="broadcast-duration">Duration</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id="broadcast-duration" aria-label="Broadcast duration"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 hour</SelectItem>
                  <SelectItem value="6">6 hours</SelectItem>
                  <SelectItem value="12">12 hours</SelectItem>
                  <SelectItem value="24">24 hours</SelectItem>
                  <SelectItem value="48">48 hours</SelectItem>
                  <SelectItem value="72">3 days</SelectItem>
                  <SelectItem value="168">1 week</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button size="sm" onClick={create} disabled={creating}>
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Send Broadcast"}
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        // Shape-matched skeleton — two broadcast rows so the loaded list
        // doesn't jump in over a lone "Loading…" line.
        <div className="space-y-2" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-ds-md liquid-glass px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-14 rounded-full" />
              </div>
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          variant="inline"
          title="We couldn't load broadcasts."
          body="Tap Try again. Your draft broadcasts are safe — this is just a fetch hiccup."
          onRetry={() => refetch()}
        />
      ) : broadcasts.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={Megaphone}
          title="Nothing scheduled"
          body="Tap New Broadcast above to push an in-app banner to every signed-in user."
        />
      ) : (
        <div className="space-y-2">
          {broadcasts.map(b => (
            <div key={b.id} className="rounded-ds-md liquid-glass px-4 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-ds-13 font-semibold text-foreground">{b.title}</p>
                  <span className={`px-2 py-0.5 rounded-full text-ds-10 font-bold uppercase ${typeBadge[b.type] || typeBadge.info}`}>
                    {b.type}
                  </span>
                  {b.pending_push_fan_out_at && !b.push_fanned_out_at ? (
                    <Badge variant="outline" className={cn("text-ds-10 border-warning/60", toneTextClasses.warning)}>Pending push</Badge>
                  ) : b.push_fanned_out_at ? (
                    <Badge variant="outline" className="text-ds-10 border-primary/30 text-primary">Sent</Badge>
                  ) : null}
                  {isActive(b) ? (
                    <Badge variant="outline" className="text-ds-10 border-primary/30 text-primary">Active</Badge>
                  ) : new Date(b.expires_at) <= new Date() ? (
                    <Badge variant="outline" className="text-ds-10 border-muted-foreground/30 text-muted-foreground">Expired</Badge>
                  ) : (
                    <Badge variant="outline" className="text-ds-10">Scheduled</Badge>
                  )}
                </div>
                <p className="text-ds-11 text-muted-foreground mt-1">{b.message}</p>
                <p className="text-ds-10 text-muted-foreground/60 mt-1">
                  Expires: {new Date(b.expires_at).toLocaleString()}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmDeleteId(b.id)}
                aria-label="Delete broadcast"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <BrandConfirmDialog
        open={!!confirmDeleteId}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}
        title="Delete This Broadcast?"
        description="It will be removed for everyone immediately. This can't be undone."
        primaryLabel={deleting ? "Deleting…" : "Delete Broadcast"}
        primaryTone="sienna"
        primaryHaptic="error"
        primaryDisabled={deleting}
        onPrimary={(e) => { e.preventDefault(); if (confirmDeleteId) remove(confirmDeleteId); }}
        secondaryLabel="Keep"
      />
    </div>
  );
};

export default AdminBroadcasts;
