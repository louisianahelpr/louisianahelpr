import { useEffect, useState, useRef } from "react";
import { formatName } from "@/lib/utils";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Flag, MessageSquare, Trash2, MoreVertical, Ban } from "lucide-react";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { hapticHeavy, hapticSuccess, hapticError } from "@/lib/haptics";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { toast } from "sonner";
import ReportDialog from "@/components/ReportDialog";
import { scanMessage } from "@/lib/messageScanner";
import { useChatPresence } from "@/hooks/useChatPresence";
import { ConversationSkeleton } from "@/components/SkeletonLoaders";
import { VirtualList } from "@/components/VirtualList";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";

import type { Conversation, Message } from "@/components/messages/types";
import { ChatView } from "@/components/messages/ChatView";

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
  const [showAllConvos, setShowAllConvos] = useState(false);
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

  // Pull-to-refresh: swiping down on the conversation list re-runs
  // loadConversations so the user can manually nudge realtime data.
  // Scoped to the inner list scroll container (not the page root) so
  // the dock + header don't capture the gesture.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: async () => { if (userId) await loadConversations(userId); },
  });

  const CONVO_LIMIT = 50;

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
        <PageScaffold
          header={<DashboardHeader />}
          titleCard={
              <div className="flex flex-col leading-none">
                <h1
                  className="font-display font-bold leading-tight"
                  style={{
                    fontSize: "clamp(1.5rem, 2vw + 0.5rem, 1.85rem)",
                    color: "hsl(var(--ink-deep))",
                    letterSpacing: "-0.025em",
                  }}
                >
                  Messages
                </h1>
                <p
                  className="mt-1 truncate font-sans font-semibold uppercase"
                  style={{
                    fontSize: "0.62rem",
                    letterSpacing: "0.16em",
                    color: "hsl(var(--olivewood) / 0.55)",
                  }}
                >
                  {conversations.length} {conversations.length === 1 ? "thread" : "threads"}
                </p>
              </div>
          }
        >
              {/* Inner header — eyebrow + title row mirroring the
                  Posts/Jobs bottom-box header pattern. */}
              <div
                className="shrink-0 flex items-center justify-between gap-3 px-4 py-3"
                style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.1)" }}
              >
                <div className="flex flex-col leading-none">
                  <span
                    className="font-serif italic tracking-[0.18em] uppercase text-[0.62rem]"
                    style={{ color: "hsl(var(--burnt-sienna) / 0.78)" }}
                  >
                    Conversations
                  </span>
                  <h2
                    className="font-display italic font-bold leading-tight mt-1"
                    style={{
                      fontSize: "1.25rem",
                      color: "hsl(var(--ink-deep))",
                      letterSpacing: "-0.018em",
                    }}
                  >
                    All threads
                  </h2>
                </div>
              </div>
              {!loading && loadError && conversations.length === 0 ? (
                <div className="px-3 pt-4 flex-1 min-h-0 flex">
                  <ErrorState
                    title="We couldn't load your messages."
                    onRetry={() => { if (userId) loadConversations(userId); }}
                  />
                </div>
              ) : !loading && conversations.length === 0 ? (
                <div className="px-3 pt-4 flex-1 min-h-0 flex">
                  <EmptyState
                    icon={MessageSquare}
                    eyebrow="Quiet for now"
                    title="No messages yet."
                    body="Apply to a task or accept a helpr's offer — your conversations will land here."
                    action={
                      <BarkPillButton onClick={() => navigate("/dashboard")}>
                        Browse tasks
                      </BarkPillButton>
                    }
                  />
                </div>
              ) : (
              <PullToRefreshWrapper
                ref={containerRef}
                pullDistance={pullDistance}
                refreshing={refreshing}
                isPulling={isPulling}
                canTrigger={canTrigger}
                className="flex-1 min-h-0 px-3 py-3"
                style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)" }}
              >
              <div className="space-y-2">
              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4].map((i) => (
                    <ConversationSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {(() => {
                    const visibleConvos = showAllConvos ? conversations : conversations.slice(0, CONVO_LIMIT);
                    return (
                      <VirtualList
                        items={visibleConvos}
                        getKey={(c) => `${c.jobId}_${c.otherUserId}`}
                        estimateSize={104}
                        overscan={6}
                        itemClassName="pb-2"
                        renderItem={(c) => {
                          // Relative time so the list reads as "active",
                          // not as a stack of full dates.
                          const ageMs = Date.now() - new Date(c.lastAt).getTime();
                          const ageMin = Math.floor(ageMs / 60000);
                          const ageHr = Math.floor(ageMin / 60);
                          const ageDay = Math.floor(ageHr / 24);
                          const when =
                            ageMin < 1 ? "now" :
                            ageMin < 60 ? `${ageMin}m` :
                            ageHr < 24 ? `${ageHr}h` :
                            ageDay < 7 ? `${ageDay}d` :
                            new Date(c.lastAt).toLocaleDateString([], { month: "short", day: "numeric" });
                          // Status chip — short label so it fits inline
                          // next to the job title. Same color logic as
                          // the chat-header status pill.
                          const statusChip = c.jobStatus && (() => {
                            const s = c.jobStatus;
                            if (s === "open") return { label: "Open", color: "hsl(var(--bark))", bg: "hsl(var(--bark) / 0.12)" };
                            if (s === "assigned" || s === "in_progress") return { label: "Awarded", color: "hsl(var(--burnt-sienna))", bg: "hsl(var(--burnt-sienna) / 0.12)" };
                            if (s === "completed") return { label: "Done", color: "hsl(var(--olivewood) / 0.9)", bg: "hsl(var(--olivewood) / 0.10)" };
                            if (s === "cancelled") return { label: "Cancelled", color: "hsl(var(--destructive))", bg: "hsl(var(--destructive) / 0.10)" };
                            return null;
                          })();
                          return (
                          <div
                            className="w-full text-left p-3 rounded-ds-md liquid-glass hover:shadow-md transition-shadow flex items-center gap-2.5"
                          >
                            {/* Avatar — uses real photo when available, falls
                                back to bark-tinted initials circle. */}
                            <div
                              className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center overflow-hidden self-center"
                              style={{
                                background: "hsl(var(--bark) / 0.12)",
                                border: "1px solid hsl(var(--bark) / 0.22)",
                              }}
                            >
                              {c.otherUserAvatarUrl ? (
                                <img
                                  loading="lazy"
                                  decoding="async"
                                  src={c.otherUserAvatarUrl}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-ds-13 font-bold" style={{ color: "hsl(var(--bark))" }}>
                                  {c.otherUserName.charAt(0).toUpperCase()}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => openConvo(c)}
                              className="flex-1 min-w-0 text-left self-center"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <p
                                      className="font-display italic font-bold truncate"
                                      style={{ fontSize: "0.92rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
                                    >
                                      {c.otherUserName}
                                    </p>
                                    {c.unread > 0 && (
                                      <span
                                        className="shrink-0 px-1.5 h-4 min-w-[1rem] rounded-full text-[0.65rem] font-bold flex items-center justify-center"
                                        style={{
                                          background: "hsl(var(--burnt-sienna))",
                                          color: "hsl(var(--parchment))",
                                        }}
                                      >
                                        {c.unread}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <p
                                      className="text-[0.7rem] truncate font-serif italic"
                                      style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                                    >
                                      {c.jobTitle}
                                    </p>
                                    {statusChip && (
                                      <span
                                        className="text-[8.5px] font-sans font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                                        style={{ color: statusChip.color, backgroundColor: statusChip.bg, letterSpacing: "0.08em" }}
                                      >
                                        {statusChip.label}
                                      </span>
                                    )}
                                  </div>
                                  <p
                                    className="text-[0.78rem] truncate mt-0.5"
                                    style={{
                                      color: c.unread > 0 ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.75)",
                                      fontWeight: c.unread > 0 ? 600 : 400,
                                    }}
                                  >
                                    {c.lastMessage || "—"}
                                  </p>
                                </div>
                                <span
                                  className="text-[0.7rem] shrink-0 self-start whitespace-nowrap"
                                  style={{ color: "hsl(var(--olivewood) / 0.6)" }}
                                >
                                  {when}
                                </span>
                              </div>
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary transition-colors shrink-0"
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label="Conversation options"
                                >
                                  <MoreVertical className="w-4 h-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setReportTarget({ type: "user", id: c.otherUserId })}>
                                  <Flag className="w-4 h-4 mr-2" /> Report user
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setBlockTarget({ id: c.otherUserId, name: c.otherUserName })}>
                                  <Ban className="w-4 h-4 mr-2" /> Block user
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteConvoConfirm(c)}>
                                  <Trash2 className="w-4 h-4 mr-2" /> Delete conversation
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          );
                        }}
                      />
                    );
                  })()}
                  {!showAllConvos && conversations.length > CONVO_LIMIT && (
                    <button onClick={() => setShowAllConvos(true)} className="w-full text-center py-3 text-ds-13 text-primary font-medium hover:underline">
                      Show all {conversations.length} conversations
                    </button>
                  )}
                </div>
              )}
              </div>
              </PullToRefreshWrapper>
              )}
        </PageScaffold>
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
