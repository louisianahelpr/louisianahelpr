import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Trash2, Megaphone, Loader2 } from "lucide-react";

interface Broadcast {
  id: string;
  title: string;
  message: string;
  type: string;
  starts_at: string;
  expires_at: string;
  created_at: string;
}

const AdminBroadcasts = () => {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Form
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState("info");
  const [duration, setDuration] = useState("24"); // hours
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("broadcast_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setBroadcasts(data as Broadcast[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!title.trim() || !message.trim()) {
      toast.error("Title and message are required");
      return;
    }
    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const expiresAt = new Date(Date.now() + parseInt(duration) * 60 * 60 * 1000).toISOString();

    const { error } = await supabase.from("broadcast_messages").insert({
      title: title.trim(),
      message: message.trim(),
      type,
      created_by: user.id,
      expires_at: expiresAt,
    });

    setCreating(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Broadcast sent!");
      setTitle("");
      setMessage("");
      setType("info");
      setDuration("24");
      setShowForm(false);
      load();
    }
  };

  const remove = async (id: string) => {
    await supabase.from("broadcast_messages").delete().eq("id", id);
    setBroadcasts(prev => prev.filter(b => b.id !== id));
    toast.success("Broadcast removed");
  };

  const isActive = (b: Broadcast) => {
    const now = new Date();
    return new Date(b.starts_at) <= now && new Date(b.expires_at) > now;
  };

  const typeBadge: Record<string, string> = {
    info: "bg-primary/10 text-primary",
    warning: "bg-accent/10 text-accent-foreground",
    urgent: "bg-destructive/10 text-destructive",
    promo: "bg-primary/10 text-primary",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-display font-bold text-foreground flex items-center gap-2">
          <Megaphone className="w-5 h-5" /> Broadcast Messages
        </h2>
        <Button size="sm" onClick={() => setShowForm(!showForm)} className="gap-1">
          <Plus className="w-3.5 h-3.5" /> New Broadcast
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Scheduled Maintenance" maxLength={100} />
          </div>
          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="We'll be performing maintenance tonight from 10pm-12am CST." rows={2} maxLength={500} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">ℹ️ Info</SelectItem>
                  <SelectItem value="warning">⚠️ Warning</SelectItem>
                  <SelectItem value="urgent">🚨 Urgent</SelectItem>
                  <SelectItem value="promo">📣 Promo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Duration</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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

      {loading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
      ) : broadcasts.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">No broadcasts yet</div>
      ) : (
        <div className="space-y-2">
          {broadcasts.map(b => (
            <div key={b.id} className="rounded-xl border border-border bg-card px-4 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-foreground">{b.title}</p>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${typeBadge[b.type] || typeBadge.info}`}>
                    {b.type}
                  </span>
                  {isActive(b) ? (
                    <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">Active</Badge>
                  ) : new Date(b.expires_at) <= new Date() ? (
                    <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground">Expired</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">Scheduled</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{b.message}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  Expires: {new Date(b.expires_at).toLocaleString()}
                </p>
              </div>
              <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => remove(b.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminBroadcasts;
