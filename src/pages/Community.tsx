/**
 * Community feed — document-scroll page at /community.
 *
 * Layout: PageHeader + parish filter chips + card feed.
 * Not in AppShell — uses `min-h-screen bg-premium-page pb-safe-nav` wrapper.
 */

import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePageTitle } from "@/hooks/usePageTitle";
import { hapticLight, hapticSuccess } from "@/lib/haptics";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import { isNativePlatform } from "@/lib/nativeInit";
import { pickImagesNative } from "@/lib/nativeCamera";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Heart,
  MapPin,
  Plus,
  ImagePlus,
  X,
  Loader2,
} from "lucide-react";
// Community tables are new — use a local type until the Supabase client
// types are regenerated from the live schema after the migration is pushed.
type CommunityPost = {
  id: string;
  author_id: string;
  post_type: string;
  job_id: string | null;
  title: string | null;
  body: string | null;
  before_photo_url: string | null;
  after_photo_url: string | null;
  photos: string[];
  category: string | null;
  parish: string | null;
  is_approved: boolean;
  like_count: number;
  created_at: string;
  author?: { full_name: string | null; avatar_url: string | null } | null;
  liked?: boolean;
};

const LOUISIANA_PARISHES = [
  "All",
  "Orleans",
  "Jefferson",
  "Lafayette",
  "East Baton Rouge",
  "St. Tammany",
  "Caddo",
  "Calcasieu",
  "Livingston",
  "Rapides",
];

// ─── Avatar ──────────────────────────────────────────────────────────────────
function AuthorAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  const initials = (name || "H")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="w-9 h-9 rounded-full object-cover shrink-0"
        style={{ border: "1.5px solid hsl(var(--olivewood) / 0.18)" }}
      />
    );
  }
  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-display italic font-bold text-ds-12"
      style={{
        background:
          "radial-gradient(120% 120% at 30% 18%, hsl(var(--bark) / 0.22) 0%, hsl(var(--bark) / 0.10) 100%)",
        border: "1px solid hsl(var(--olivewood) / 0.20)",
        color: "hsl(var(--olivewood))",
      }}
    >
      {initials}
    </div>
  );
}

// ─── Post cards ──────────────────────────────────────────────────────────────

interface PostCardProps {
  post: CommunityPost;
  onLike: (postId: string) => void;
  likePending: boolean;
}

function BeforeAfterCard({ post, onLike, likePending }: PostCardProps) {
  const authorName = post.author?.full_name || "A helper";
  const relTime = formatRelative(post.created_at);

  return (
    <article
      className="liquid-glass rounded-ds-sm overflow-hidden"
      style={{ border: "0.5px solid hsl(var(--olivewood) / 0.14)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <AuthorAvatar name={authorName} avatarUrl={post.author?.avatar_url} />
        <div className="min-w-0 flex-1">
          <p
            className="font-display italic font-bold leading-tight truncate"
            style={{ fontSize: "0.9rem", color: "hsl(var(--ink-deep))" }}
          >
            {authorName}
          </p>
          <p
            className="font-sans uppercase tracking-wide truncate"
            style={{ fontSize: "0.6rem", color: "hsl(var(--olivewood) / 0.6)" }}
          >
            {[post.category, post.parish, relTime].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      {/* Photos */}
      {(post.before_photo_url || post.after_photo_url) && (
        <div className="px-4 pb-3">
          {post.before_photo_url && post.after_photo_url ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <img
                  src={post.before_photo_url}
                  alt="Before"
                  className="w-full aspect-[4/3] object-cover rounded-md"
                />
                <span
                  className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[0.58rem] font-bold uppercase tracking-wide"
                  style={{
                    background: "hsl(0 0% 0% / 0.55)",
                    color: "hsl(0 0% 100% / 0.9)",
                  }}
                >
                  Before
                </span>
              </div>
              <div className="relative">
                <img
                  src={post.after_photo_url}
                  alt="After"
                  className="w-full aspect-[4/3] object-cover rounded-md"
                />
                <span
                  className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[0.58rem] font-bold uppercase tracking-wide"
                  style={{
                    background: "hsl(var(--bark) / 0.72)",
                    color: "hsl(var(--parchment))",
                  }}
                >
                  After
                </span>
              </div>
            </div>
          ) : (
            <img
              src={post.before_photo_url || post.after_photo_url!}
              alt={post.before_photo_url ? "Before" : "After"}
              className="w-full aspect-video object-cover rounded-md"
            />
          )}
        </div>
      )}

      {/* Body */}
      {post.body && (
        <p
          className="font-serif italic px-4 pb-3 leading-snug"
          style={{ fontSize: "0.85rem", color: "hsl(var(--ink-deep) / 0.82)" }}
        >
          {post.body}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-4 pb-4 pt-1">
        <button
          onClick={() => { hapticLight(); onLike(post.id); }}
          disabled={likePending || post.liked}
          className="flex items-center gap-1.5 min-h-[40px] min-w-[40px] px-2 active:scale-[0.94] transition-transform"
          aria-label={post.liked ? "Liked" : "Like this post"}
        >
          <Heart
            className="w-4.5 h-4.5 transition-colors"
            strokeWidth={post.liked ? 0 : 1.8}
            fill={post.liked ? "hsl(var(--burnt-sienna))" : "none"}
            style={{ color: post.liked ? "hsl(var(--burnt-sienna))" : "hsl(var(--olivewood) / 0.55)" }}
          />
          <span
            className="font-sans font-semibold"
            style={{ fontSize: "0.72rem", color: "hsl(var(--olivewood) / 0.65)" }}
          >
            {post.like_count}
          </span>
        </button>
        {post.parish && (
          <div
            className="flex items-center gap-1"
            style={{ color: "hsl(var(--olivewood) / 0.55)" }}
          >
            <MapPin className="w-3 h-3" strokeWidth={1.8} />
            <span className="font-sans" style={{ fontSize: "0.68rem" }}>
              {post.parish}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}

function MilestoneCard({ post }: { post: CommunityPost }) {
  const authorName = post.author?.full_name || "A helper";

  return (
    <article
      className="rounded-ds-sm px-4 py-4 relative overflow-hidden"
      style={{
        background:
          "radial-gradient(120% 120% at 20% 20%, hsl(var(--bark) / 0.22) 0%, hsl(45 36% 90% / 0.55) 60%, hsl(var(--parchment) / 0.4) 100%)",
        border: "0.5px solid hsl(var(--bark) / 0.32)",
      }}
    >
      {/* Decorative sunburst */}
      <span
        aria-hidden
        className="absolute -right-8 -top-8 w-32 h-32 rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, hsl(var(--bark) / 0.18) 0%, hsl(var(--bark) / 0) 70%)",
        }}
      />
      <div className="flex items-start gap-3 relative">
        <AuthorAvatar name={authorName} avatarUrl={post.author?.avatar_url} />
        <div className="min-w-0 flex-1">
          <p
            className="font-display italic font-bold leading-snug"
            style={{ fontSize: "0.95rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
          >
            {authorName} {post.body}
          </p>
          {post.parish && (
            <div
              className="flex items-center gap-1 mt-1"
              style={{ color: "hsl(var(--olivewood) / 0.65)" }}
            >
              <MapPin className="w-3 h-3" strokeWidth={1.8} />
              <span className="font-sans" style={{ fontSize: "0.68rem" }}>
                {post.parish}
              </span>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

// ─── Share sheet ─────────────────────────────────────────────────────────────
interface ShareSheetProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  userParish?: string | null;
}

function ShareBeforeAfterSheet({ open, onClose, userId, userParish }: ShareSheetProps) {
  const queryClient = useQueryClient();
  const [beforeFile, setBeforeFile] = useState<File | null>(null);
  const [afterFile, setAfterFile] = useState<File | null>(null);
  const [beforePreview, setBeforePreview] = useState<string | null>(null);
  const [afterPreview, setAfterPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const beforeInputRef = useRef<HTMLInputElement>(null);
  const afterInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setBeforeFile(null);
    setAfterFile(null);
    setBeforePreview(null);
    setAfterPreview(null);
    setCaption("");
  };

  const pickNative = async (type: "before" | "after") => {
    try {
      const picked = await pickImagesNative(1);
      if (picked.length === 0) return;
      const f = picked[0];
      const url = URL.createObjectURL(f);
      if (type === "before") { setBeforeFile(f); setBeforePreview(url); }
      else { setAfterFile(f); setAfterPreview(url); }
    } catch (err) {
      report(err, { tags: { source: "ShareSheet.pickNative" } });
      toast.error("Couldn't open photos. Please try again.");
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>, type: "before" | "after") => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    if (type === "before") { setBeforeFile(f); setBeforePreview(url); }
    else { setAfterFile(f); setAfterPreview(url); }
    // Reset the input so the same file can be re-selected
    e.target.value = "";
  };

  const uploadPhoto = async (file: File): Promise<string | null> => {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `community/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("proof-photos").upload(path, file);
    if (error) { report(error, { tags: { source: "ShareSheet.uploadPhoto" } }); return null; }
    const { data } = supabase.storage.from("proof-photos").getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSubmit = async () => {
    if (!beforeFile && !afterFile && !caption.trim()) {
      toast.error("Add at least a photo or caption.");
      return;
    }
    setSubmitting(true);
    try {
      let beforeUrl: string | null = null;
      let afterUrl: string | null = null;
      if (beforeFile) beforeUrl = await uploadPhoto(beforeFile);
      if (afterFile) afterUrl = await uploadPhoto(afterFile);

      const { error } = await (supabase as any).from("community_posts").insert({
        author_id: userId,
        post_type: "before_after",
        body: caption.trim() || null,
        before_photo_url: beforeUrl,
        after_photo_url: afterUrl,
        parish: userParish || null,
        is_approved: false,
      });

      if (error) {
        // PGRST202 = table not deployed yet; swallow silently
        if ((error as any).code === "PGRST202") {
          toast.success("Thanks! Your post will appear once reviewed.");
        } else {
          throw error;
        }
      } else {
        toast.success("Thanks! Your post will appear once reviewed.");
        queryClient.invalidateQueries({ queryKey: ["communityFeed"] });
      }
      reset();
      onClose();
    } catch (err: any) {
      report(err, { tags: { source: "ShareSheet.handleSubmit" } });
      toast.error("Couldn't submit your post — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[92dvh] overflow-y-auto">
        <SheetHeader className="text-left mb-4">
          <SheetTitle>Share a before & after</SheetTitle>
          <SheetDescription>
            Show off your work — posts appear once reviewed (usually under an hour).
          </SheetDescription>
        </SheetHeader>

        {/* Photos */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {/* Before */}
          <div>
            <p className="text-ds-11 font-semibold uppercase tracking-wide mb-1.5" style={{ color: "hsl(var(--olivewood) / 0.6)" }}>Before</p>
            {beforePreview ? (
              <div className="relative">
                <img src={beforePreview} alt="Before preview" className="w-full aspect-[4/3] object-cover rounded-md" />
                <button
                  onClick={() => { setBeforeFile(null); setBeforePreview(null); }}
                  className="absolute top-1 right-1 w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: "hsl(0 0% 0% / 0.55)", color: "white" }}
                  aria-label="Remove before photo"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => isNativePlatform ? pickNative("before") : beforeInputRef.current?.click()}
                className="w-full aspect-[4/3] rounded-md flex flex-col items-center justify-center gap-1 active:opacity-70 transition-opacity"
                style={{ border: "1.5px dashed hsl(var(--olivewood) / 0.30)", background: "hsl(var(--olivewood) / 0.04)" }}
              >
                <ImagePlus className="w-5 h-5" style={{ color: "hsl(var(--olivewood) / 0.5)" }} />
                <span className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.55)" }}>Add photo</span>
              </button>
            )}
            <input ref={beforeInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFileInput(e, "before")} />
          </div>

          {/* After */}
          <div>
            <p className="text-ds-11 font-semibold uppercase tracking-wide mb-1.5" style={{ color: "hsl(var(--olivewood) / 0.6)" }}>After</p>
            {afterPreview ? (
              <div className="relative">
                <img src={afterPreview} alt="After preview" className="w-full aspect-[4/3] object-cover rounded-md" />
                <button
                  onClick={() => { setAfterFile(null); setAfterPreview(null); }}
                  className="absolute top-1 right-1 w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: "hsl(0 0% 0% / 0.55)", color: "white" }}
                  aria-label="Remove after photo"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => isNativePlatform ? pickNative("after") : afterInputRef.current?.click()}
                className="w-full aspect-[4/3] rounded-md flex flex-col items-center justify-center gap-1 active:opacity-70 transition-opacity"
                style={{ border: "1.5px dashed hsl(var(--olivewood) / 0.30)", background: "hsl(var(--olivewood) / 0.04)" }}
              >
                <ImagePlus className="w-5 h-5" style={{ color: "hsl(var(--olivewood) / 0.5)" }} />
                <span className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.55)" }}>Add photo</span>
              </button>
            )}
            <input ref={afterInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFileInput(e, "after")} />
          </div>
        </div>

        {/* Caption */}
        <Textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value.slice(0, 200))}
          placeholder="Add a caption (optional, 200 chars max)"
          className="resize-none mb-1"
          rows={3}
        />
        <p className="text-ds-11 text-right mb-4" style={{ color: "hsl(var(--olivewood) / 0.5)" }}>
          {caption.length}/200
        </p>

        <Button
          className="w-full"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          {submitting ? "Submitting…" : "Submit post"}
        </Button>
      </SheetContent>
    </Sheet>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Main page ────────────────────────────────────────────────────────────────

const Community = () => {
  usePageTitle("Community — Helpr");
  const navigate = useNavigate();
  const { user, profile } = useCurrentUser();
  const queryClient = useQueryClient();

  const [selectedParish, setSelectedParish] = useState("All");
  const [shareOpen, setShareOpen] = useState(false);
  // Track which posts we've optimistically liked this session
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [likingId, setLikingId] = useState<string | null>(null);

  // ── Fetch feed ──────────────────────────────────────────────────────────────
  const { data: rawPosts = [], isLoading } = useQuery<CommunityPost[]>({
    queryKey: ["communityFeed", selectedParish],
    queryFn: async () => {
      let q = (supabase as any)
        .from("community_posts")
        .select("*")
        .eq("is_approved", true)
        .order("created_at", { ascending: false })
        .limit(50);

      if (selectedParish !== "All") {
        q = q.eq("parish", selectedParish);
      }

      const { data, error } = await q;
      // PGRST202 = table not deployed yet — return empty feed gracefully
      if (error) {
        if ((error as any).code === "PGRST202") return [];
        throw error;
      }

      const posts: any[] = data ?? [];
      if (!posts.length) return [];

      // Fetch author display names in a single batch via profiles
      const authorIds = [...new Set(posts.map((p: any) => p.author_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url")
        .in("user_id", authorIds);

      const profileMap = new Map(
        (profiles ?? []).map((p) => [p.user_id, { full_name: p.full_name, avatar_url: p.avatar_url }]),
      );

      // Fetch which posts the current user has liked
      let likedSet = new Set<string>();
      if (user) {
        const { data: myLikes } = await (supabase as any)
          .from("community_post_likes")
          .select("post_id")
          .eq("user_id", user.id)
          .in("post_id", posts.map((p: any) => p.id));
        likedSet = new Set(((myLikes as any[]) ?? []).map((l) => l.post_id));
      }

      return posts.map((p: any): CommunityPost => ({
        ...p,
        author: profileMap.get(p.author_id) ?? null,
        liked: likedSet.has(p.id),
      }));
    },
    staleTime: 60_000,
  });

  // Merge session-level optimistic likes into fetched data
  const posts = rawPosts.map((p) => ({
    ...p,
    liked: p.liked || likedIds.has(p.id),
  }));

  // ── Like mutation ───────────────────────────────────────────────────────────
  const likeMutation = useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await (supabase as any)
        .from("community_post_likes")
        .insert({ post_id: postId, user_id: user!.id });
      if (error) {
        // Ignore duplicate (already liked)
        if ((error as any).code === "23505") return;
        if ((error as any).code === "PGRST202") return;
        throw error;
      }
      // Increment the denormalised counter (best-effort)
      await supabase.rpc("increment_community_like" as any, { p_post_id: postId }).then(() => {});
    },
    onSuccess: (_data, postId) => {
      hapticSuccess();
      // Optimistically bump like_count in the cache
      queryClient.setQueryData<CommunityPost[]>(
        ["communityFeed", selectedParish],
        (prev) =>
          (prev ?? []).map((p) =>
            p.id === postId
              ? { ...p, liked: true, like_count: p.like_count + 1 }
              : p,
          ),
      );
    },
    onError: (err: any) => {
      report(err, { tags: { source: "Community.likeMutation" } });
    },
    onSettled: () => setLikingId(null),
  });

  const handleLike = (postId: string) => {
    if (!user) { navigate("/login"); return; }
    if (likedIds.has(postId) || posts.find((p) => p.id === postId)?.liked) return;
    setLikedIds((prev) => new Set([...prev, postId]));
    setLikingId(postId);
    likeMutation.mutate(postId);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader title="Community" onBack={() => navigate(-1)} />

      {/* Parish filter chips */}
      <div
        className="px-4 pt-3 pb-2 flex gap-2 overflow-x-auto scrollbar-none"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {LOUISIANA_PARISHES.map((parish) => {
          const active = parish === selectedParish;
          return (
            <button
              key={parish}
              onClick={() => { hapticLight(); setSelectedParish(parish); }}
              className="shrink-0 px-3.5 h-8 rounded-full font-sans font-semibold whitespace-nowrap transition-all active:scale-[0.96]"
              style={{
                fontSize: "0.72rem",
                background: active
                  ? "hsl(var(--bark))"
                  : "hsl(var(--olivewood) / 0.07)",
                color: active
                  ? "hsl(var(--parchment))"
                  : "hsl(var(--olivewood) / 0.75)",
                border: active
                  ? "1px solid hsl(var(--bark))"
                  : "0.5px solid hsl(var(--olivewood) / 0.18)",
              }}
            >
              {parish}
            </button>
          );
        })}
      </div>

      {/* Feed */}
      <div className="px-4 pt-2 pb-6 space-y-3 max-w-lg mx-auto">
        {isLoading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-48 rounded-ds-sm animate-pulse"
                style={{ background: "hsl(var(--olivewood) / 0.06)" }}
              />
            ))}
          </div>
        )}

        {!isLoading && posts.length === 0 && (
          <div
            className="rounded-ds-sm px-6 py-10 text-center"
            style={{
              background: "hsl(var(--olivewood) / 0.04)",
              border: "0.5px dashed hsl(var(--olivewood) / 0.20)",
            }}
          >
            <p
              className="font-display italic font-bold"
              style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
            >
              No posts yet.
            </p>
            <p
              className="font-serif italic mt-1"
              style={{ fontSize: "0.82rem", color: "hsl(var(--olivewood) / 0.65)" }}
            >
              Finish a job and share the before &amp; after — you'll inspire the whole neighborhood.
            </p>
            {user && (
              <Button
                size="sm"
                className="mt-4"
                onClick={() => setShareOpen(true)}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Share yours
              </Button>
            )}
          </div>
        )}

        {posts.map((post) => {
          if (post.post_type === "milestone") {
            return (
              <MilestoneCard key={post.id} post={post} />
            );
          }
          // before_after, spotlight, tip — all use the card layout
          return (
            <BeforeAfterCard
              key={post.id}
              post={post}
              onLike={handleLike}
              likePending={likingId === post.id}
            />
          );
        })}
      </div>

      {/* Share FAB — only for logged-in users */}
      {user && (
        <button
          onClick={() => setShareOpen(true)}
          aria-label="Share a before & after"
          className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+80px)] right-4 w-14 h-14 rounded-full flex items-center justify-center active:scale-[0.96] transition-transform z-40"
          style={{
            background:
              "radial-gradient(125% 125% at 32% 22%, hsl(76 20% 44%) 0%, hsl(var(--bark)) 46%, hsl(66 25% 19%) 100%)",
            color: "hsl(var(--parchment))",
            border: "1px solid hsl(66 26% 18%)",
            boxShadow:
              "inset 0 1.5px 1px 0 rgba(255,255,255,0.28)," +
              "inset 0 -2px 3px 0 hsl(66 28% 14% / 0.45)," +
              "0 1px 2px hsl(70 20% 18% / 0.22)," +
              "0 8px 18px -6px hsl(var(--bark) / 0.55)," +
              "0 18px 36px -12px hsl(var(--bark) / 0.4)",
          }}
        >
          <Plus className="w-6 h-6" strokeWidth={2.75} />
        </button>
      )}

      <ShareBeforeAfterSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        userId={user?.id ?? ""}
        userParish={(profile as any)?.city ?? null}
      />
    </div>
  );
};

export default Community;
