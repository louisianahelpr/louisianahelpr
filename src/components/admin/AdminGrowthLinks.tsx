/**
 * Admin -> Growth links (owner-approved growth items, B59, 2026-10-29).
 *
 * 1. Matchmaker links: build a "Post this job" link to answer "anyone know a
 *    handyman?" posts. It opens Post a job filled in at Details for whoever
 *    taps it (after signup if needed). Nothing is stored: the link carries the
 *    fields (src/lib/matchmakerLink.ts).
 * 2. Who brings customers: per Helpr, how many new posters their "Book me"
 *    link brought (admin_booking_sources; test accounts never counted).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Share2, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ADMIN_DELETED_ACCOUNT_LABEL } from "@/lib/deletedPerson";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { AdminCard, AdminViewShell } from "@/components/admin/AdminViewShell";
import { rpcErrorMessage } from "@/components/admin/adminRpcErrorCopy";
import { JOB_CATEGORIES, type JobCategory } from "@/lib/jobCategories";
import { buildMatchmakerLink, matchmakerSummary } from "@/lib/matchmakerLink";
import { copyToClipboard, shareNative } from "@/lib/nativeShare";
import { formatShortDate } from "@/lib/format";

function MatchmakerBuilder() {
  const [category, setCategory] = useState<JobCategory | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [town, setTown] = useState("");
  const [zip, setZip] = useState("");
  const [price, setPrice] = useState("");
  const priceNum = /^\d+$/.test(price.trim()) ? Number(price.trim()) : null;
  const fields = category
    ? { category, title, description, town, zip, price: priceNum }
    : null;
  const link = fields ? buildMatchmakerLink(fields) : "";
  const summary = fields ? matchmakerSummary(fields) : "";

  const copy = async () => {
    if (await copyToClipboard(link)) toast.success("Link copied.");
    else toast.error("Couldn't copy. Select the link and copy it.");
  };
  const share = () =>
    void shareNative({ title: summary, text: `Post this job on Louisiana Helpr: ${summary}`, url: link, dialogTitle: "Share this job link" });

  return (
    <AdminCard
      title="Matchmaker link"
      subtitle="Answer an “anyone know a handyman?” post with a link that opens Post a job already filled in."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="mm-category">Category</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as JobCategory)}>
            <SelectTrigger id="mm-category" aria-label="Category">
              <SelectValue placeholder="Pick a category" />
            </SelectTrigger>
            <SelectContent>
              {JOB_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mm-title">Job title</Label>
          <Input id="mm-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Fix a leaking faucet" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="mm-desc">Short description</Label>
          <Textarea id="mm-desc" value={description} maxLength={500} rows={3} onChange={(e) => setDescription(e.target.value)} placeholder="What needs doing, in a sentence or two." />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mm-town">Town</Label>
          <Input id="mm-town" value={town} maxLength={60} onChange={(e) => setTown(e.target.value)} placeholder="Lafayette" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="mm-zip">ZIP</Label>
            <Input id="mm-zip" value={zip} inputMode="numeric" maxLength={5} onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))} placeholder="70501" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mm-price">Price ($)</Label>
            <Input id="mm-price" value={price} inputMode="numeric" maxLength={4} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} placeholder="80" />
          </div>
        </div>
      </div>
      {fields ? (
        <div className="mt-5 space-y-3" data-testid="mm-preview">
          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <p className="text-ds-11 font-semibold uppercase tracking-wide text-muted-foreground">Link preview</p>
            <p className="mt-1 font-semibold text-foreground">Post this job: {summary}</p>
            <p className="text-sm text-muted-foreground">Opens Post a job on Louisiana Helpr, filled in and ready to check.</p>
            <p className="mt-2 break-all text-ds-12 text-muted-foreground" data-testid="mm-link">{link}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="rounded-full" onClick={share}>
              <Share2 className="mr-2 h-4 w-4" aria-hidden />
              Share
            </Button>
            <Button type="button" className="btn-grad-primary rounded-full" onClick={() => void copy()}>
              <Copy className="mr-2 h-4 w-4" aria-hidden />
              Copy link
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">Pick a category to make the link.</p>
      )}
    </AdminCard>
  );
}

function BookingSources() {
  const q = useQuery({
    queryKey: ["admin", "booking-sources"],
    queryFn: async () => unwrap(await supabase.rpc("admin_booking_sources")),
  });
  return (
    <AdminCard title="Who brings customers" subtitle="New posters who came through a Helpr’s “Book me” link. Test accounts never count.">
      {q.isPending ? (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : q.isError ? (
        <ErrorState
          variant="inline"
          title="We couldn't load this."
          body={rpcErrorMessage("admin_booking_sources", q.error) ?? "Tap Try again."}
          onRetry={() => void q.refetch()}
        />
      ) : !q.data?.length ? (
        <EmptyState icon={Users} title="No one yet" body="When a new poster comes through a Helpr’s Book me link, it shows here." />
      ) : (
        <ul className="divide-y divide-border">
          {q.data.map((r) => (
            <li key={r.helpr_id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0 truncate font-medium text-foreground">{r.helpr_name || ADMIN_DELETED_ACCOUNT_LABEL}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {r.posters_brought} brought · {r.posters_who_posted} posted · last {formatShortDate(r.last_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </AdminCard>
  );
}

export default function AdminGrowthLinks() {
  return (
    <AdminViewShell>
      <MatchmakerBuilder />
      <BookingSources />
    </AdminViewShell>
  );
}
