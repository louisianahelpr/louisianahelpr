import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, Send, Loader2, Facebook } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const AdminSocialPost = () => {
  const [postText, setPostText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-social-post", {
        body: { action: "generate" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPostText(data.post || "");
      toast.success("Post generated!");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate post");
    } finally {
      setGenerating(false);
    }
  };

  const handlePublish = async () => {
    if (!postText.trim()) {
      toast.error("Generate or write a post first");
      return;
    }
    setPublishing(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-social-post", {
        body: { action: "publish", message: postText },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Posted to Facebook via Make!");
      setPostText("");
    } catch (e: any) {
      toast.error(e.message || "Failed to publish post");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Facebook className="h-5 w-5 text-blue-600" />
            Facebook Post Generator
          </CardTitle>
          <CardDescription>
            Use AI to generate a Facebook post, edit it if needed, then publish via Make.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button onClick={handleGenerate} disabled={generating} className="gap-2">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating ? "Generating…" : "Generate Post"}
            </Button>
          </div>

          <Textarea
            placeholder="Your post will appear here. You can also type or edit manually…"
            value={postText}
            onChange={(e) => setPostText(e.target.value)}
            rows={6}
            className="text-base"
          />

          <p className="text-xs text-muted-foreground">{postText.length} characters</p>

          <Button
            onClick={handlePublish}
            disabled={publishing || !postText.trim()}
            variant="default"
            className="gap-2"
          >
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {publishing ? "Posting…" : "Post to Facebook"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminSocialPost;
