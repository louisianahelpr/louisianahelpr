import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Download, Copy, Check, Calendar, Clock, ShieldCheck, Trophy, CalendarDays, Users, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface Caption {
  pillar: string;
  suggested_day: string;
  suggested_time: string;
  caption: string;
}

const pillarMeta: Record<string, { color: string; icon: React.ElementType; blurb: string }> = {
  Safety: { color: "bg-blue-600", icon: ShieldCheck, blurb: "Trust & verification" },
  "Local Wins": { color: "bg-emerald-600", icon: Trophy, blurb: "Real Acadiana stories" },
  Planning: { color: "bg-amber-600", icon: CalendarDays, blurb: "Book ahead, breathe easy" },
  Community: { color: "bg-purple-600", icon: Users, blurb: "Neighbors helping neighbors" },
};

const AdminMarketingToolkit = () => {
  const [generating, setGenerating] = useState(false);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-marketing-toolkit");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setCaptions(data.captions || []);
      setGeneratedAt(data.generated_at || new Date().toISOString());
      toast.success(`${data.captions?.length || 0} captions ready for the month`);
    } catch (e: any) {
      toast.error(e.message || "Failed to generate toolkit");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async (caption: string, idx: number) => {
    await navigator.clipboard.writeText(caption);
    setCopiedIdx(idx);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  const handleDownload = () => {
    if (captions.length === 0) return;
    const lines: string[] = [];
    lines.push("LOUISIANA HELPR — MONTHLY MARKETING TOOLKIT");
    lines.push(`Generated: ${generatedAt ? format(new Date(generatedAt), "MMM d, yyyy h:mm a") : ""}`);
    lines.push("=".repeat(60));
    lines.push("");
    captions.forEach((c, i) => {
      lines.push(`Post ${i + 1} — Pillar: ${c.pillar}`);
      lines.push(`Best time: ${c.suggested_day} @ ${c.suggested_time}`);
      lines.push("-".repeat(40));
      lines.push(c.caption);
      lines.push("");
      lines.push("");
    });

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `helpr-marketing-toolkit-${format(new Date(), "yyyy-MM-dd")}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Toolkit downloaded");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Marketing Toolkit
          </CardTitle>
          <CardDescription>
            Four pre-written, non-robotic Facebook captions for the month — one per content pillar. Each post includes
            an optimal posting day & time so you can schedule directly in Meta Business Suite.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {Object.entries(pillarMeta).map(([name, meta]) => {
              const Icon = meta.icon;
              return (
                <div key={name} className="flex items-center gap-2 rounded-lg border border-border p-2">
                  <div className={`${meta.color} rounded-md p-1.5 text-white shrink-0`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold leading-tight truncate">{name}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight truncate">{meta.blurb}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleGenerate} disabled={generating} className="gap-2">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating ? "Writing your toolkit…" : "Generate Monthly Toolkit"}
            </Button>
            {captions.length > 0 && (
              <Button onClick={handleDownload} variant="secondary" className="gap-2">
                <Download className="h-4 w-4" />
                Download Toolkit (.txt)
              </Button>
            )}
          </div>
          {generatedAt && (
            <p className="text-xs text-muted-foreground mt-3">
              Last generated: {format(new Date(generatedAt), "MMM d, yyyy h:mm a")} · {captions.length} posts
            </p>
          )}
        </CardContent>
      </Card>

      {captions.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {captions.map((c, idx) => {
            const meta = pillarMeta[c.pillar] || { color: "bg-muted", icon: Wrench, blurb: "" };
            const Icon = meta.icon;
            return (
              <Card key={idx} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge className={`${meta.color} gap-1 text-white`}>
                      <Icon className="h-3 w-3" />
                      {c.pillar}
                    </Badge>
                    <span className="text-xs text-muted-foreground">Post #{idx + 1}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground pt-2">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {c.suggested_day}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {c.suggested_time}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{c.caption}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCopy(c.caption, idx)}
                    className="gap-1 w-full"
                  >
                    {copiedIdx === idx ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedIdx === idx ? "Copied" : "Copy caption"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminMarketingToolkit;
