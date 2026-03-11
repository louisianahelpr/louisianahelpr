import { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Send, Flag, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import ReportDialog from "@/components/ReportDialog";
import { scanMessage } from "@/lib/messageScanner";

type Message = {
  id: string;
  job_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  read: boolean;
  created_at: string;
};

type Conversation = {
  otherUserId: string;
  otherUserName: string;
  jobTitle: string;
  jobId: string;
  lastMessage: string;
  lastAt: string;
  unread: number;
};

const Messages = () => {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [reportTarget, setReportTarget] = useState<{ type: "message"; id: string } | null>(null);
  const [warningShown, setWarningShown] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate("/login"); return; }
      setUserId(user.id);
      await loadConversations(user.id);
    };
    init();
  }, []);

  const loadConversations = async (uid: string) => {
    setLoading(true);
    const { data: msgs } = await supabase
      .from("messages")
      .select("*")
      .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
      .order("created_at", { ascending: false });

    if (!msgs || msgs.length === 0) { setLoading(false); return; }

    const convoMap = new Map<string, { otherUserId: string; jobId: string; messages: Message[] }>();
    for (const m of msgs) {
      const other = m.sender_id === uid ? m.receiver_id : m.sender_id;
      const key = `${m.job_id}_${other}`;
      if (!convoMap.has(key)) convoMap.set(key, { otherUserId: other, jobId: m.job_id, messages: [] });
      convoMap.get(key)!.messages.push(m);
    }

    const otherIds = [...new Set([...convoMap.values()].map((c) => c.otherUserId))];
    const jobIds = [...new Set([...convoMap.values()].map((c) => c.jobId))];

    const [profilesRes, jobsRes] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name").in("user_id", otherIds),
      supabase.from("jobs").select("id, title").in("id", jobIds),
    ]);

    const profileMap = new Map(profilesRes.data?.map((p) => [p.user_id, p.full_name || "User"]) || []);
    const jobMap = new Map(jobsRes.data?.map((j) => [j.id, j.title]) || []);

    const convos: Conversation[] = [...convoMap.entries()].map(([, v]) => ({
      otherUserId: v.otherUserId,
      otherUserName: profileMap.get(v.otherUserId) || "User",
      jobTitle: jobMap.get(v.jobId) || "Job",
      jobId: v.jobId,
      lastMessage: v.messages[0].content,
      lastAt: v.messages[0].created_at,
      unread: v.messages.filter((m) => m.receiver_id === uid && !m.read).length,
    }));

    convos.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
    setConversations(convos);
    setLoading(false);
  };

  const openConvo = async (convo: Conversation) => {
    setActiveConvo(convo);
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("job_id", convo.jobId)
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${convo.otherUserId}),and(sender_id.eq.${convo.otherUserId},receiver_id.eq.${userId})`)
      .order("created_at", { ascending: true });

    if (data) {
      setMessages(data);
      const unreadIds = data.filter((m) => m.receiver_id === userId && !m.read).map((m) => m.id);
      if (unreadIds.length > 0) {
        await supabase.from("messages").update({ read: true }).in("id", unreadIds);
      }
    }
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  // Realtime subscription
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel("messages-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const msg = payload.new as Message;
        if (msg.sender_id === userId || msg.receiver_id === userId) {
          if (activeConvo && msg.job_id === activeConvo.jobId) {
            setMessages((prev) => [...prev, msg]);
            if (msg.receiver_id === userId) {
              supabase.from("messages").update({ read: true }).eq("id", msg.id);
            }
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
          }
          loadConversations(userId);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, activeConvo]);

  const logViolation = async (violationDescription: string) => {
    if (!userId) return;
    // Check if user already has a warning for off-platform
    const { data: existing } = await supabase
      .from("user_violations" as any)
      .select("id")
      .eq("user_id", userId)
      .eq("violation_type", "off_platform");

    const priorCount = (existing as any[] | null)?.length || 0;

    if (priorCount >= 1) {
      // 2nd offense: permanent ban
      await (supabase.from("user_bans" as any) as any).insert({
        user_id: userId,
        ban_type: "permanent",
        reason: "Repeated off-platform activity: " + violationDescription,
        banned_by: userId, // system-issued
      });
      await supabase.from("profiles").update({ ban_status: "permanently_banned" } as any).eq("user_id", userId);
      await (supabase.from("user_violations" as any) as any).insert({
        user_id: userId,
        violation_type: "off_platform",
        description: violationDescription,
        action_taken: "permanent_ban",
      });
      // Notify admins
      const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      if (adminRoles) {
        for (const admin of adminRoles) {
          await supabase.from("notifications").insert({
            user_id: admin.user_id,
            title: "⛔ User permanently banned",
            message: `A user was auto-banned for repeated off-platform activity: ${violationDescription}`,
            type: "warning",
            link: "/admin",
          });
        }
      }
      toast.error("Your account has been banned for violating platform rules.");
    } else {
      // 1st offense: warning
      await (supabase.from("user_violations" as any) as any).insert({
        user_id: userId,
        violation_type: "off_platform",
        description: violationDescription,
        action_taken: "warning",
      });
      await supabase.from("profiles").update({ ban_status: "warned" } as any).eq("user_id", userId);
      // Notify admins
      const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      if (adminRoles) {
        for (const admin of adminRoles) {
          await supabase.from("notifications").insert({
            user_id: admin.user_id,
            title: "⚠️ Off-platform attempt detected",
            message: `A user attempted off-platform activity: ${violationDescription}`,
            type: "warning",
            link: "/admin",
          });
        }
      }
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !activeConvo || !userId) return;

    // Scan for off-platform activity
    const violations = scanMessage(newMessage);
    if (violations.length > 0) {
      const violationDesc = violations.map((v) => v.label).join(", ");

      if (!warningShown) {
        // Show warning first
        setWarningShown(true);
        toast.error(
          "⚠️ Warning: Sharing contact info or taking business off-platform is not allowed. This is your first warning — a second offense will result in a permanent ban.",
          { duration: 8000 }
        );
        // Log the violation
        await logViolation(violationDesc);
        return; // Block the message
      } else {
        // Already warned, log and ban
        await logViolation(violationDesc);
        return;
      }
    }

    const { error } = await supabase.from("messages").insert({
      job_id: activeConvo.jobId,
      sender_id: userId,
      receiver_id: activeConvo.otherUserId,
      content: newMessage.trim(),
    });
    if (error) toast.error("Failed to send message");
    setNewMessage("");
  };

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center h-16 px-4 gap-4">
          {activeConvo ? (
            <Button variant="ghost" size="icon" onClick={() => setActiveConvo(null)}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
          )}
          <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
          {activeConvo && (
            <div className="flex-1 text-right">
              <p className="text-sm font-medium text-foreground">{activeConvo.otherUserName}</p>
              <p className="text-xs text-muted-foreground">{activeConvo.jobTitle}</p>
            </div>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="max-w-3xl mx-auto">
          {!activeConvo ? (
            <div className="space-y-4">
              <h1 className="text-3xl font-display font-bold text-foreground">Messages</h1>
              {loading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : conversations.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-muted-foreground">No messages yet. Apply to a task to start chatting!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {conversations.map((c) => (
                    <button
                      key={`${c.jobId}_${c.otherUserId}`}
                      onClick={() => openConvo(c)}
                      className="w-full text-left p-4 rounded-xl border border-border bg-card hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-foreground truncate">{c.otherUserName}</p>
                            {c.unread > 0 && (
                              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
                                {c.unread}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{c.jobTitle}</p>
                          <p className="text-sm text-muted-foreground truncate mt-1">{c.lastMessage}</p>
                        </div>
                        <span className="text-xs text-muted-foreground ml-2 whitespace-nowrap">
                          {new Date(c.lastAt).toLocaleDateString()}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col" style={{ height: "calc(100vh - 10rem)" }}>
              {/* Community rules banner */}
              <div className="rounded-lg bg-accent/10 border border-accent/20 p-3 mb-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-accent-foreground mt-0.5 shrink-0" />
                <p className="text-xs text-accent-foreground">
                  Keep all communication and payments on Helpr. Sharing contact info or taking business off-platform will result in a warning, then a permanent ban.
                </p>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 py-4">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.sender_id === userId ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm group relative ${
                        m.sender_id === userId
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : "bg-secondary text-secondary-foreground rounded-bl-md"
                      }`}
                    >
                      <p>{m.content}</p>
                      <p className={`text-xs mt-1 ${m.sender_id === userId ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                        {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      {m.sender_id !== userId && (
                        <button
                          onClick={() => setReportTarget({ type: "message", id: m.id })}
                          className="absolute -right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        >
                          <Flag className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="flex gap-2 pt-3 border-t border-border">
                <Input
                  placeholder="Type a message…"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                  className="flex-1"
                />
                <Button size="icon" onClick={sendMessage} disabled={!newMessage.trim()}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>

      {reportTarget && (
        <ReportDialog
          open={!!reportTarget}
          onClose={() => setReportTarget(null)}
          reportedType={reportTarget.type}
          reportedId={reportTarget.id}
        />
      )}
    </div>
  );
};

export default Messages;
