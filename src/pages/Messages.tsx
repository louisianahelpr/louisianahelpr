import { useEffect, useState, useRef } from "react";
import { formatName } from "@/lib/utils";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Flag, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import ReportDialog from "@/components/ReportDialog";
import { scanMessage } from "@/lib/messageScanner";
import { QuickReplies } from "@/components/QuickReplies";
import { RichMessageInput } from "@/components/RichMessageInput";
import { useChatPresence, OnlineIndicator, TypingIndicator, ReadReceipt } from "@/components/ChatPresence";
import { ConversationSkeleton } from "@/components/SkeletonLoaders";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";

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
  usePageTitle("Messages — Helpr");
  const navigate = useNavigate();
  const { user: cachedUser } = useCurrentUser();
  const [userId, setUserId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportTarget, setReportTarget] = useState<{ type: "message"; id: string } | null>(null);
  const [warningShown, setWarningShown] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Chat presence
  const { isOtherOnline, isOtherTyping, broadcastTyping } = useChatPresence({
    channelName: activeConvo ? `chat-${activeConvo.jobId}-${[userId, activeConvo.otherUserId].sort().join("-")}` : "none",
    userId: userId || "",
    otherUserId: activeConvo?.otherUserId || "",
  });

  // Seed from cache for instant render
  useEffect(() => {
    if (cachedUser && !userId) {
      setUserId(cachedUser.id);
      loadConversations(cachedUser.id);
    }
  }, [cachedUser]);

  useEffect(() => {
    if (userId) return; // already seeded from cache
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;
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
      supabase.rpc("get_safe_profiles", { user_ids: otherIds }),
      supabase.from("jobs").select("id, title").in("id", jobIds),
    ]);

    const profileMap = new Map(profilesRes.data?.map((p) => [p.user_id, formatName(p.full_name)]) || []);
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
    navigate("/messages?chat=1", { replace: true });
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
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        const updated = payload.new as Message;
        setMessages((prev) => prev.map((m) => m.id === updated.id ? updated : m));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, activeConvo]);

  const logViolation = async (violationDescription: string, blockedContent: string) => {
    if (!userId) return;
    const userName = activeConvo?.otherUserName || "Unknown";
    const senderName = cachedUser?.user_metadata?.full_name || "A user";

    const { data: existing } = await supabase
      .from("user_violations" as any)
      .select("id")
      .eq("user_id", userId)
      .eq("violation_type", "off_platform");

    const priorCount = (existing as any[] | null)?.length || 0;

    if (priorCount >= 1) {
      await (supabase.from("user_bans" as any) as any).insert({
        user_id: userId, ban_type: "permanent",
        reason: "Repeated off-platform activity: " + violationDescription, banned_by: userId,
      });
      await supabase.from("profiles").update({ ban_status: "permanently_banned" } as any).eq("user_id", userId);
      await (supabase.from("user_violations" as any) as any).insert({
        user_id: userId, violation_type: "off_platform",
        description: `${violationDescription} | Message: "${blockedContent}"`, action_taken: "permanent_ban",
      });
      const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      if (adminRoles) {
        for (const admin of adminRoles) {
          await createNotification({
            user_id: admin.user_id, title: "⛔ User permanently banned",
            message: `${senderName} was auto-banned for repeated off-platform activity. They tried to send: "${blockedContent.slice(0, 100)}" (${violationDescription})`,
            type: "warning", link: `/admin?tab=reports`,
          });
        }
      }
      toast.error("Your account has been banned for violating platform rules.");
    } else {
      await (supabase.from("user_violations" as any) as any).insert({
        user_id: userId, violation_type: "off_platform",
        description: `${violationDescription} | Message: "${blockedContent}"`, action_taken: "warning",
      });
      await supabase.from("profiles").update({ ban_status: "warned" } as any).eq("user_id", userId);
      const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      if (adminRoles) {
        for (const admin of adminRoles) {
          await createNotification({
            user_id: admin.user_id, title: "⚠️ Off-platform attempt detected",
            message: `${senderName} tried to send: "${blockedContent.slice(0, 100)}" (${violationDescription})`,
            type: "warning", link: `/admin?tab=reports`,
          });
        }
      }
    }
  };

  const sendMessage = async (content: string) => {
    if (!content.trim() || !activeConvo || !userId) return;

    // Skip scanning for system-generated messages (location shares, photos)
    const isSystemMessage = content.startsWith("📍 Location:") || content.startsWith("📷 ");

    // Scan for off-platform activity (skip for location/photo messages)
    if (!isSystemMessage) {
      const violations = scanMessage(content);
      if (violations.length > 0) {
        const violationDesc = violations.map((v) => v.label).join(", ");
        if (!warningShown) {
          setWarningShown(true);
          toast.error(
            "⚠️ Warning: Sharing contact info or taking business off-platform is not allowed. This is your first warning — a second offense will result in a permanent ban.",
            { duration: 8000 }
          );
          await logViolation(violationDesc, content);
          return;
        } else {
          await logViolation(violationDesc, content);
          return;
        }
      }
    }

    const { error } = await supabase.from("messages").insert({
      job_id: activeConvo.jobId,
      sender_id: userId,
      receiver_id: activeConvo.otherUserId,
      content: content.trim(),
    });
    if (error) toast.error("Failed to send message");
  };

  const renderMessageContent = (content: string) => {
    // Photo message
    if (content.startsWith("📷 ")) {
      const parts = content.slice(2).trim().split("\n");
      const url = parts[0].trim();
      const caption = parts.slice(1).join("\n").trim();
      return (
        <div className="space-y-1">
          <img
            src={url}
            alt="Shared photo"
            className="max-w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => window.open(url, "_blank")}
            loading="lazy"
          />
          {caption && <p>{caption}</p>}
        </div>
      );
    }
    // Location message
    if (content.startsWith("📍 Location:")) {
      const url = content.replace("📍 Location: ", "");
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 underline hover:no-underline"
        >
          📍 View location on map
        </a>
      );
    }
    return <p>{content}</p>;
  };

  return (
    <div className={`min-h-screen bg-background ${activeConvo ? '' : 'pb-20'}`}>
      <DashboardHeader />

      <main className={`container mx-auto px-4 ${activeConvo ? 'pt-0' : 'py-6'}`}>
        <div className="max-w-3xl mx-auto">
          {!activeConvo ? (
            <div className="space-y-4">
              <h1 className="text-3xl font-display font-bold text-foreground">Messages</h1>
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4].map((i) => (
                    <ConversationSkeleton key={i} />
                  ))}
                </div>
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
            <div className="flex flex-col h-[calc(100dvh-4rem)]">
              {/* Chat header with back button and user info */}
              <div className="flex items-center gap-3 p-3 -mx-4 -mt-0 border-b border-border mb-3 bg-card">
                <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 shrink-0" onClick={() => { setActiveConvo(null); navigate("/messages", { replace: true }); }}>
                  <ArrowLeft className="w-5 h-5" />
                </Button>
                <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <span className="text-base font-bold text-primary">{activeConvo.otherUserName.charAt(0).toUpperCase()}</span>
                </div>
                <div className="min-w-0 flex-1 overflow-hidden">
                  <p className="font-semibold text-foreground text-sm truncate flex items-center gap-2">
                    <span className="truncate">{activeConvo.otherUserName}</span>
                    <OnlineIndicator isOnline={isOtherOnline} />
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{activeConvo.jobTitle}</p>
                </div>
              </div>
              {/* Community rules banner */}
              {!bannerDismissed && (
                <div className="rounded-lg bg-accent/10 border border-accent/20 p-3 mb-3 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-accent-foreground mt-0.5 shrink-0" />
                  <p className="text-xs text-accent-foreground flex-1">
                    Keep all communication and payments on Helpr. Sharing contact info or taking business off-platform will result in a warning, then a permanent ban.
                  </p>
                  <button onClick={() => setBannerDismissed(true)} className="text-accent-foreground/60 hover:text-accent-foreground shrink-0 mt-0.5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                </div>
              )}

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
                      {renderMessageContent(m.content)}
                      <div className={`flex items-center gap-1 mt-1 ${m.sender_id === userId ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                        <span className="text-xs">
                          {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <ReadReceipt read={m.read} sentByMe={m.sender_id === userId} />
                      </div>
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
                {isOtherTyping && <TypingIndicator />}
                <div ref={bottomRef} />
              </div>

              {/* Quick replies */}
              <div className="pt-2">
                <QuickReplies onSelect={sendMessage} />
              </div>

              {/* Rich message input */}
              <div className="pt-2 border-t border-border">
                <RichMessageInput
                  onSend={sendMessage}
                  onTyping={broadcastTyping}
                />
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
