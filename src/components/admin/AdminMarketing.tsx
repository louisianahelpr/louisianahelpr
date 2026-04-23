import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Mail, Send, Users, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Segment = "all" | "helpers" | "posters" | "by_parish";

const PARISHES = [
  "Orleans", "Jefferson", "East Baton Rouge", "Caddo", "St. Tammany",
  "Lafayette", "Calcasieu", "Ouachita", "Rapides", "Bossier", "Livingston",
  "Tangipahoa", "Ascension", "St. Bernard", "Iberia", "Terrebonne",
];

const AdminMarketing = () => {
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState(
    `<p>Hey {{name}},</p>\n<p>We've got something new for you on Helpr…</p>\n<p>— The Helpr team</p>`
  );
  const [segment, setSegment] = useState<Segment>("all");
  const [parish, setParish] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<{ sent: number; failed: number; total: number } | null>(null);

  const send = async (asTest: boolean) => {
    if (!subject.trim() || !html.trim()) {
      toast.error("Subject and body are required");
      return;
    }
    if (asTest && !testEmail.trim()) {
      toast.error("Enter a test email");
      return;
    }
    if (segment === "by_parish" && !parish) {
      toast.error("Pick a parish");
      return;
    }
    if (!asTest) {
      const ok = window.confirm(
        `Send this campaign to all matching ${segment === "all" ? "users" : segment}? This cannot be undone.`
      );
      if (!ok) return;
    }
    setSending(true);
    setLastResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("send-marketing-blast", {
        body: {
          subject: subject.trim(),
          html: html.trim(),
          segment,
          parish: segment === "by_parish" ? parish : undefined,
          test_email: asTest ? testEmail.trim() : undefined,
        },
      });
      if (error) throw error;
      setLastResult({ sent: data?.sent ?? 0, failed: data?.failed ?? 0, total: data?.total ?? 0 });
      toast.success(
        asTest
          ? `Test email sent to ${testEmail}`
          : `Campaign sent: ${data?.sent ?? 0} delivered, ${data?.failed ?? 0} failed`
      );
    } catch (e: any) {
      toast.error(e.message || "Send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Mail className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-2xl font-display font-bold">Marketing Campaigns</h2>
          <p className="text-sm text-muted-foreground">
            One-off announcement emails to segmented users. Honors promotional opt-out.
          </p>
        </div>
      </div>

      <Alert>
        <AlertTriangle className="w-4 h-4" />
        <AlertDescription>
          Always send a <strong>test</strong> first. Use <code className="px-1 rounded bg-muted">{`{{name}}`}</code> in the body to personalize with the recipient's first name.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compose</CardTitle>
          <CardDescription>HTML body — keep it short, mobile-first.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="A new way to find help in your parish"
              maxLength={150}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="html">HTML body</Label>
            <Textarea
              id="html"
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              rows={10}
              className="font-mono text-xs"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4" /> Audience
          </CardTitle>
          <CardDescription>Only verified, approved users will receive emails.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Segment</Label>
              <Select value={segment} onValueChange={(v) => setSegment(v as Segment)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All users</SelectItem>
                  <SelectItem value="helpers">Helprs only</SelectItem>
                  <SelectItem value="posters">Posters only</SelectItem>
                  <SelectItem value="by_parish">By parish</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {segment === "by_parish" && (
              <div className="space-y-2">
                <Label>Parish</Label>
                <Select value={parish} onValueChange={setParish}>
                  <SelectTrigger><SelectValue placeholder="Pick a parish" /></SelectTrigger>
                  <SelectContent>
                    {PARISHES.map(p => <SelectItem key={p} value={p}>{p} Parish</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send</CardTitle>
          <CardDescription>Test first, then send to the full segment.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="test">Test email</Label>
            <div className="flex gap-2">
              <Input
                id="test"
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="you@louisianahelpr.com"
              />
              <Button variant="outline" disabled={sending} onClick={() => send(true)}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send test"}
              </Button>
            </div>
          </div>

          <Button
            className="w-full"
            size="lg"
            disabled={sending}
            onClick={() => send(false)}
          >
            {sending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
            ) : (
              <><Send className="w-4 h-4 mr-2" /> Send campaign</>
            )}
          </Button>

          {lastResult && (
            <div className="rounded-lg border bg-muted/40 p-4 text-sm">
              <p className="font-semibold">Last send result</p>
              <p className="text-muted-foreground">
                {lastResult.sent} delivered · {lastResult.failed} failed · {lastResult.total} total
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminMarketing;
