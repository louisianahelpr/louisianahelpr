import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Send, Loader2, Facebook, Trash2, Check, Clock, Eye, Share2, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface Draft {
  id: string;
  content: string;
  style: string | null;
  status: string;
  created_at: string;
  published_at: string | null;
  image_url: string | null;
  media_type: string;
}

const AdminSocialPost = () => {
  const [postText, setPostText] = useState("");
  const [postImage, setPostImage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [sendingToSocial, setSendingToSocial] = useState(false);

  const handleSendToSocial = async () => {
    if (!postText.trim()) {
      toast.error("Write or generate a post first");
      return;
    }
    setSendingToSocial(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-to-social", {
        body: {
          post_text: postText.trim(),
          image_url: postImage,
          timing_priority: "Optimized",
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Sent to Make for scheduling!");
    } catch (e: any) {
      toast.error(e.message || "Failed to send to Make");
    } finally {
      setSendingToSocial(false);
    }
  };

  const fetchDrafts = async () => {
    const { data, error } = await supabase
      .from("social_post_drafts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (!error && data) setDrafts(data as Draft[]);
    setLoading(false);
  };

  useEffect(() => { fetchDrafts(); }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-social-post", {
        body: { action: "generate" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPostText(data.post || "");
      setPostImage(data.image_url || null);
      toast.success(`Generated post${data.image_url ? " with image" : " (image failed)"}`);
    } catch (e: any) {
      toast.error(e.message || "Failed to generate post");
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!postText.trim()) { toast.error("Write or generate a post first"); return; }
    const { error } = await supabase
      .from("social_post_drafts")
      .insert({
        content: postText.trim(),
        style: "manual",
        status: "draft",
        image_url: postImage,
        media_type: "image",
      } as any);
    if (error) { toast.error("Failed to save draft"); return; }
    toast.success("Draft saved!");
    setPostText("");
    setPostImage(null);
    fetchDrafts();
  };

  const handlePublish = async (draft: Draft) => {
    setPublishing(draft.id);
    try {
      const { data, error } = await supabase.functions.invoke("generate-social-post", {
        body: {
          action: "publish",
          message: draft.content,
          image_url: draft.image_url,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      await supabase
        .from("social_post_drafts")
        .update({ status: "published", published_at: new Date().toISOString() } as any)
        .eq("id", draft.id);

      toast.success("Posted to Facebook!");
      fetchDrafts();
    } catch (e: any) {
      toast.error(e.message || "Failed to publish");
    } finally {
      setPublishing(null);
    }
  };

  const handleReject = async (id: string) => {
    await supabase
      .from("social_post_drafts")
      .update({ status: "rejected" } as any)
      .eq("id", id);
    toast.success("Draft rejected");
    fetchDrafts();
  };

  const handleUpdateDraft = async (id: string) => {
    if (!editText.trim()) return;
    await supabase
      .from("social_post_drafts")
      .update({ content: editText.trim() } as any)
      .eq("id", id);
    toast.success("Draft updated");
    setEditingId(null);
    setEditText("");
    fetchDrafts();
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "draft": return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />Pending Review</Badge>;
      case "published": return <Badge className="gap-1 bg-green-600"><Check className="h-3 w-3" />Published</Badge>;
      case "rejected": return <Badge variant="destructive" className="gap-1"><Trash2 className="h-3 w-3" />Rejected</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Generator */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Facebook className="h-5 w-5" />
            Facebook Post Generator
          </CardTitle>
          <CardDescription>
            Generates a Louisiana-flavored launch post with an AI-generated image.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={handleGenerate} disabled={generating} className="gap-2">
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generating ? "Generating…" : "Generate Post"}
          </Button>

          <Textarea
            placeholder="Your post will appear here. You can also type or edit manually…"
            value={postText}
            onChange={(e) => setPostText(e.target.value)}
            rows={5}
            className="text-base"
          />

          {/* Image preview */}
          {postImage && (
            <div className="rounded-lg border overflow-hidden bg-muted">
              <img src={postImage} alt="Generated post" className="w-full max-h-80 object-cover" />
              <div className="p-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>AI-generated image</span>
                <button onClick={() => setPostImage(null)} className="hover:text-foreground underline">Remove</button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              {postText.length} characters · <Badge variant="outline" className="gap-1"><ImageIcon className="h-3 w-3" />Image</Badge>
            </p>
            <div className="flex gap-2">
              <Button onClick={handleSaveDraft} disabled={!postText.trim()} variant="secondary" className="gap-2">
                <Eye className="h-4 w-4" />
                Save as Draft
              </Button>
              <Button
                onClick={handleSendToSocial}
                disabled={!postText.trim() || sendingToSocial}
                className="gap-2"
              >
                {sendingToSocial ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                Send to Social
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Drafts Queue */}
      <Card>
        <CardHeader>
          <CardTitle>Post Queue</CardTitle>
          <CardDescription>Review and approve posts before they go live on Facebook.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : drafts.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No drafts yet. Generate one above or wait for the auto-scheduler.</p>
          ) : (
            <div className="space-y-4">
              {drafts.map((draft) => (
                <div key={draft.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {statusBadge(draft.status)}
                      <Badge variant="outline" className="gap-1"><ImageIcon className="h-3 w-3" />Image</Badge>
                      {draft.style && <span className="text-xs text-muted-foreground capitalize">{draft.style}</span>}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(draft.created_at), "MMM d, yyyy h:mm a")}
                    </span>
                  </div>

                  {editingId === draft.id ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={4}
                        className="text-sm"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleUpdateDraft(draft.id)}>Save Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm whitespace-pre-wrap">{draft.content}</p>
                      {draft.image_url && (
                        <img
                          src={draft.image_url}
                          alt="Post image"
                          className="rounded-md border max-h-64 object-cover w-full"
                        />
                      )}
                    </>
                  )}

                  {draft.status === "draft" && editingId !== draft.id && (
                    <div className="flex gap-2 pt-1 flex-wrap">
                      <Button
                        size="sm"
                        onClick={() => handlePublish(draft)}
                        disabled={publishing === draft.id}
                        className="gap-1"
                      >
                        {publishing === draft.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                        Approve & Post
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setEditingId(draft.id); setEditText(draft.content); }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => handleReject(draft.id)}
                      >
                        Reject
                      </Button>
                    </div>
                  )}

                  {draft.status === "published" && draft.published_at && (
                    <p className="text-xs text-muted-foreground">
                      Published {format(new Date(draft.published_at), "MMM d, yyyy h:mm a")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminSocialPost;
