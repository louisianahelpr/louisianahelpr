import { useEffect, useState, useRef } from "react";
import { formatName } from "@/lib/utils";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { hapticHeavy, hapticSuccess, hapticError } from "@/lib/haptics";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { toast } from "sonner";
import ReportDialog from "@/components/ReportDialog";
import { scanMessage } from "@/lib/messageScanner";
import { useChatPresence } from "@/hooks/useChatPresence";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";

import type { Conversation, Message } from "@/components/messages/types";
import { ChatView } from "@/components/messages/ChatView";
import { ConversationList } from "@/components/messages/ConversationList";

const CHAT_PAGE_SIZE = 50;

const Messages = () => {
  usePageTitle("Messages — Helpr");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const deepLinkJobId = searchParams.get("jobId");
  const deepLinkUserId = searchParams.get("userId");
  const { user: cachedUser } = useCurrentUser();
  const [userId, setUserId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: "message" | "user"; id: string } | null>(null);
  const [blockTarget, setBlockTarget] = useState<{ id: string; name: string } | null>(null);
  const [warningShown, setWarningShown] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deleteConvoConfirm, setDeleteConvoConfirm] = useState<Conversation | null>(null);
  const [deleteMessageConfirm, setDeleteMessageConfirm] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const deepLinkHandled = useRef(false);
  const keyboardInset = useKeyboardInset();

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

  // Fallback auth check only if useCurrentUser hasn't loaded yet
  useEffect(() => {
    if (userId || cachedUser) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUserId(session.user.id);
        loadConversations(session.user.id);
      }
    });
  }, [userId, cachedUser]);

  const loadConversations = async (uid: string) => {
    // Only show the skeleton on the very first load. Background refreshes
    // (e.g. realtime updates, returning to the page) keep the existing UI.
    setConversations((prev) => {
      if (prev.length === 0) setLoading(true);
      return prev;
    });

    // Fetch blocked-user IDs first so we can hide them from the list
    const { getBlockedUserIds } = await import("@/lib/userBlocks");
    const blockedSet = await getBlockedUserIds(uid);

    const { data: msgs, error: msgsError } = await supabase
      .from("messages")
      .select("*")
      .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
      .order("created_at", { ascending: false })
      .limit(200);

    // Surface a failed fetch as a recoverable ErrorState rather than
    // letting it fall through to the "No messages yet" empty state.
    if (msgsError) { setLoadError(true); setLoading(false); return; }
    setLoadError(false);

    if (!msgs || msgs.length === 0) { setLoading(false); return; }

    const filteredMsgs = msgs.filter((m: any) => {
      const other = m.sender_id === uid ? m.receiver_id : m.sender_id;
      return !blockedSet.has(other);
    });

    const convoMap = new Map<string, { otherUserId: string; jobId: string; messages: Message[] }>();
    for (const m of filteredMsgs) {
      const other = m.sender_id === uid ? m.receiver_id : m.sender_id;
      const key = `${m.job_id}_${other}`;
      if (!convoMap.has(key)) convoMap.set(key, { otherUserId: other, jobId: m.job_id, messages: [] });
      convoMap.get(key)!.messages.push(m);
    }

    const otherIds = [...new Set([...convoMap.values()].map((c) => c.otherUserId))];
    const jobIds = [...new Set([...convoMap.values()].map((c) => c.jobId))];

    const [profilesRes, jobsRes] = await Promise.all([
      supabase.rpc("get_safe_profiles", { user_ids: otherIds }),
      supabase.from("jobs").select("id, title, status, customer_id").in("id", jobIds),
    ]);

    const profileMap = new Map(profilesRes.data?.map((p) => [p.user_id, formatName(p.full_name)]) || []);
    const avatarMap = new Map<string, string | null>(profilesRes.data?.map((p) => [p.user_id, p.avatar_url ?? null]) || []);
    const jobMap = new Map(jobsRes.data?.map((j) => [j.id, { title: j.title, status: j.status, customer_id: j.customer_id }]) || []);

    const convos: Conversation[] = [...convoMap.entries()].map(([, v]) => ({
      otherUserId: v.otherUserId,
      otherUserName: profileMap.get(v.otherUserId) || "User",
      otherUserAvatarUrl: avatarMap.get(v.otherUserId) ?? null,
      jobTitle: jobMap.get(v.jobId)?.title || "Job",
      jobId: v.jobId,
      jobStatus: jobMap.get(v.jobId)?.status ?? null,
      // Track whether the current user is the poster on this job so the
      // chat can render poster-specific quick replies (vs helper-specific).
      viewerIsPoster: jobMap.get(v.jobId)?.customer_id === uid,
      lastMessage: v.messages[0].content,
      lastAt: v.messages[0].created_at,
      unread: v.messages.filter((m) => m.receiver_id === uid && !m.read).length,
    }));

    convos.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
    setConversations(convos);
    setLoading(false);

    // Auto-open conversation from deep link
    if (deepLinkJobId && deepLinkUserId && !deepLinkHandled.current) {
      deepLinkHandled.current = true;
      const match = convos.find(c => c.jobId === deepLinkJobId && c.otherUserId === deepLinkUserId);
      if (match) {
        setActiveConvo(match);
        navigate("/messages?chat=1", { replace: true });
      } else {
        // No existing conversation — create a placeholder so user can start messaging
        const [profileRes, jobRes] = await Promise.all([
          supabase.rpc("get_safe_profiles", { user_ids: [deepLinkUserId] }),
          supabase.from("jobs").select("id, title, status, customer_id").eq("id", deepLinkJobId).maybeSingle(),
        ]);
        const name = profileRes.data?.[0]?.full_name || "User";
        const placeholder: Conversation = {
          otherUserId: deepLinkUserId,
          otherUserName: formatName(name),
          otherUserAvatarUrl: profileRes.data?.[0]?.avatar_url ?? null,
          jobTitle: jobRes.data?.title || "Job",
          jobId: deepLinkJobId,
          jobStatus: jobRes.data?.status ?? null,
          viewerIsPoster: jobRes.data?.customer_id === uid,
          lastMessage: "",
          lastAt: new Date().toISOString(),
          unread: 0,
        };
        setConversations(prev => [placeholder, ...prev]);
        setActiveConvo(placeholder);
        navigate("/messages?chat=1", { replace: true });
      }
    }
  };

  const openConvo = async (convo: Conversation) => {
    setActiveConvo(convo);
    setHasMoreMessages(false);
    navigate("/messages?chat=1", { replace: true });
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("job_id", convo.jobId)
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${convo.otherUserId}),and(sender_id.eq.${convo.otherUserId},receiver_id.eq.${userId})`)
      .order("created_at", { ascending: false })
      .limit(CHAT_PAGE_SIZE);

    if (data) {
      const sorted = [...data].reverse();
      setMessages(sorted);
      setHasMoreMessages(data.length === CHAT_PAGE_SIZE);
      const unreadIds = data.filter((m) => m.receiver_id === userId && !m.read).map((m) => m.id);
      if (unreadIds.length > 0) {
        await supabase.from("messages").update({ read: true }).in("id", unreadIds);
      }
    }
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  const loadOlderMessages = async () => {
    if (!activeConvo || !userId || loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    const oldestMsg = messages[0];
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("job_id", activeConvo.jobId)
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${activeConvo.otherUserId}),and(sender_id.eq.${activeConvo.otherUserId},receiver_id.eq.${userId})`)
      .lt("created_at", oldestMsg.created_at)
      .order("created_at", { ascending: false })
      .limit(CHAT_PAGE_SIZE);

    if (data && data.length > 0) {
      const sorted = [...data].reverse();
      // Preserve scroll position
      const container = chatContainerRef.current;
      const scrollHeightBefore = container?.scrollHeight || 0;
      setMessages((prev) => [...sorted, ...prev]);
      setHasMoreMessages(data.length === CHAT_PAGE_SIZE);
      // Restore scroll position after DOM update
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - scrollHeightBefore;
        }
      });
    } else {
      setHasMoreMessages(false);
    }
    setLoadingMore(false);
  };

  // Realtime subscription. Two channels — one for messages I receive
  // (any thread, drives the conversation-list refresh), one for messages
  // I send (so the active thread sees my echo immediately). Server-side
  // filter so we don't receive every INSERT in public.messages — at
  // scale that broadcast firehose would dwarf actual relevant traffic.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`messages-realtime-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `receiver_id=eq.${userId}`,
        },
        (payload) => {
          const msg = payload.new as Message;
          if (activeConvo && msg.job_id === activeConvo.jobId) {
            setMessages((prev) => [...prev, msg]);
            supabase.from("messages").update({ read: true }).eq("id", msg.id);
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
          }
          loadConversations(userId);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `sender_id=eq.${userId}`,
        },
        (payload) => {
          const msg = payload.new as Message;
          // Only echo into the active thread — sender's own conversation
          // list refresh happens in the optimistic sendMessage flow.
          if (activeConvo && msg.job_id === activeConvo.jobId) {
            setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `sender_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as Message;
          setMessages((prev) => prev.map((m) => m.id === updated.id ? updated : m));
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, activeConvo]);

  const logViolation = async (violationDescription: string, blockedContent: string) => {
    if (!userId) return;
    const senderName = cachedUser?.user_metadata?.full_name || "A user";

    const { data: existing } = await supabase
      .from("user_violations")
      .select("id")
      .eq("user_id", userId)
      .eq("violation_type", "off_platform");

    const priorCount = existing?.length || 0;

    if (priorCount >= 1) {
      await supabase.from("user_bans").insert({
        user_id: userId, ban_type: "permanent",
        reason: "Repeated off-platform activity: " + violationDescription, banned_by: userId,
      });
      await supabase.from("profiles").update({ ban_status: "permanently_banned" }).eq("user_id", userId);
      await supabase.from("user_violations").insert({
        user_id: userId, violation_type: "off_platform",
        description: `${violationDescription} | Message: "${blockedContent}"`, action_taken: "permanent_ban",
      });
      const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      if (adminRoles?.length) {
        await supabase.from("notifications").insert(
          adminRoles.map((a: { user_id: string }) => ({
            user_id: a.user_id,
            title: "⛔ User permanently banned",
            message: `${senderName} was auto-banned for repeated off-platform activity. They tried to send: "${blockedContent.slice(0, 100)}" (${violationDescription})`,
            type: "warning",
            link: `/admin?view=reports`,
            read: false,
          })),
        );
      }
      toast.error("Your account has been banned for violating platform rules.");
    } else {
      await supabase.from("user_violations").insert({
        user_id: userId, violation_type: "off_platform",
        description: `${violationDescription} | Message: "${blockedContent}"`, action_taken: "warning",
      });
      await supabase.from("profiles").update({ ban_status: "final_warning" }).eq("user_id", userId);
      const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      if (adminRoles?.length) {
        await supabase.from("notifications").insert(
          adminRoles.map((a: { user_id: string }) => ({
            user_id: a.user_id,
            title: "⚠️ Off-platform attempt detected",
            message: `${senderName} tried to send: "${blockedContent.slice(0, 100)}" (${violationDescription})`,
            type: "warning",
            link: `/admin?view=reports`,
            read: false,
          })),
        );
      }
    }
  };

  const sendMessage = async (
    content: string,
    attachment?: { path: string; mime: string; size: number },
  ) => {
    if (!activeConvo || !userId) return;
    if (!content.trim() && !attachment) return;

    // Skip scanning for system-generated messages (location shares, attachments)
    const isSystemMessage = content.startsWith("📍 Location:") || !!attachment;

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
      attachment_url: attachment?.path ?? null,
      attachment_mime: attachment?.mime ?? null,
      attachment_size: attachment?.size ?? null,
    });
    if (error) toast.error("Failed to send message");
  };

  const deleteConversation = async (convo: Conversation) => {
    if (!userId) return;
    hapticHeavy();
    // RLS only allows deleting own sent messages — so only delete those
    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("job_id", convo.jobId)
      .eq("sender_id", userId)
      .eq("receiver_id", convo.otherUserId);

    if (error) {
      hapticError();
      toast.error("Failed to delete conversation");
    } else {
      // Remove from local list — the other person's messages still exist for them
      setConversations((prev) => prev.filter((c) => !(c.jobId === convo.jobId && c.otherUserId === convo.otherUserId)));
      hapticSuccess();
      toast.success("Your messages in this conversation have been deleted");
    }
    setDeleteConvoConfirm(null);
  };

  const deleteMessage = async (messageId: string) => {
    hapticHeavy();
    const { error } = await supabase.from("messages").delete().eq("id", messageId);
    if (error) {
      hapticError();
      toast.error("Failed to delete message");
    } else {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      hapticSuccess();
      toast.success("Message deleted");
    }
    setDeleteMessageConfirm(null);
  };

  return (
    <>
      {!activeConvo ? (
        <ConversationList
          conversations={conversations}
          loading={loading}
          loadError={loadError}
          userId={userId}
          loadConversations={loadConversations}
          openConvo={openConvo}
          setReportTarget={setReportTarget}
          setBlockTarget={setBlockTarget}
          setDeleteConvoConfirm={setDeleteConvoConfirm}
        />
      ) : (
        <ChatView
          activeConvo={activeConvo}
          setActiveConvo={setActiveConvo}
          keyboardInset={keyboardInset}
          isOtherOnline={isOtherOnline}
          isOtherTyping={isOtherTyping}
          broadcastTyping={broadcastTyping}
          messages={messages}
          userId={userId}
          hasMoreMessages={hasMoreMessages}
          loadingMore={loadingMore}
          loadOlderMessages={loadOlderMessages}
          sendMessage={sendMessage}
          chatContainerRef={chatContainerRef}
          bottomRef={bottomRef}
          setReportTarget={setReportTarget}
          setBlockTarget={setBlockTarget}
          setDeleteMessageConfirm={setDeleteMessageConfirm}
        />
      )}

      {reportTarget && (
        <ReportDialog
          open={!!reportTarget}
          onClose={() => setReportTarget(null)}
          reportedType={reportTarget.type}
          reportedId={reportTarget.id}
        />
      )}

      {blockTarget && (
        <BlockUserDialog
          open={!!blockTarget}
          onClose={() => setBlockTarget(null)}
          blockedUserId={blockTarget.id}
          blockedUserName={blockTarget.name}
          onBlocked={() => {
            // Drop the conversation locally and exit chat view
            setConversations((prev) => prev.filter((c) => c.otherUserId !== blockTarget.id));
            if (activeConvo?.otherUserId === blockTarget.id) {
              setActiveConvo(null);
              navigate("/messages", { replace: true });
            }
          }}
        />
      )}

      {/* Delete conversation confirmation */}
      <BrandConfirmDialog
        open={!!deleteConvoConfirm}
        onOpenChange={(o) => { if (!o) setDeleteConvoConfirm(null); }}
        title="Delete conversation?"
        description={`This deletes your sent messages in this conversation with ${deleteConvoConfirm?.otherUserName ?? "this person"}. Messages you received stay visible to them. This can't be undone.`}
        primaryLabel="Delete"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => deleteConvoConfirm && deleteConversation(deleteConvoConfirm)}
        secondaryLabel="Cancel"
      />

      {/* Delete message confirmation */}
      <BrandConfirmDialog
        open={!!deleteMessageConfirm}
        onOpenChange={(o) => { if (!o) setDeleteMessageConfirm(null); }}
        title="Delete message?"
        description="This message will be permanently deleted. This can't be undone."
        primaryLabel="Delete"
        primaryTone="sienna"
        primaryHaptic="warning"
        onPrimary={() => deleteMessageConfirm && deleteMessage(deleteMessageConfirm)}
        secondaryLabel="Cancel"
      />
    </>
  );
};

export default Messages;
