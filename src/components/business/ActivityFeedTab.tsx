// Activity feed for the business team.
//
// Reads `business_activity_feed(p_business_id, p_limit, p_before)` and
// renders the timeline. Paginates by `event_at < cursor` so we don't
// need OFFSET (deletes/inserts would shift it). When the RPC is missing
// (PGRST202), we render an empty informational state.

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyStateIllustration } from "@/components/empty-state/EmptyStateIllustration";
import { Briefcase, CheckCircle2, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { formatPrice } from "@/lib/format";

interface ActivityEvent {
  event_at: string;
  actor_id: string | null;
  actor_name: string | null;
  event_type: string;
  job_id: string | null;
  job_title: string | null;
  amount: number | null;
  department: string | null;
}

interface ActivityFeedTabProps {
  businessId: string;
}

export function ActivityFeedTab({ businessId }: ActivityFeedTabProps) {
  const [before, setBefore] = useState<string | null>(null);
  const [pages, setPages] = useState<ActivityEvent[][]>([]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["business-activity-feed", businessId, before],
    queryFn: async (): Promise<{ events: ActivityEvent[]; rpcMissing: boolean }> => {
      const { data: rows, error } = await supabase.rpc("business_activity_feed" as any, {
        p_business_id: businessId,
        p_limit: 30,
        p_before: before,
      } as any);
      if (error) {
        const code = (error as { code?: string }).code;
        if (code === "PGRST202") return { events: [], rpcMissing: true };
        throw error;
      }
      return { events: (rows as ActivityEvent[] | null) ?? [], rpcMissing: false };
    },
    enabled: !!businessId,
    staleTime: 30_000,
    // Hold prior page during cursor / refetch transitions so the
    // timeline doesn't collapse to a skeleton mid-scroll.
    placeholderData: keepPreviousData,
  });

  const events = [...pages.flat(), ...(data?.events ?? [])];

  const loadMore = () => {
    if (!data?.events?.length) return;
    setPages((prev) => [...prev, data.events]);
    setBefore(data.events[data.events.length - 1].event_at);
    void refetch();
  };

  if (isLoading) {
    // Content-shaped skeleton: timeline rows mirroring the eventual
    // Card layout (icon + actor/verb/job sentence + relative timestamp).
    // Replaces a bare centered spinner.
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-3 flex items-start gap-3">
            <Skeleton className="h-4 w-4 mt-0.5 rounded-sm" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (data?.rpcMissing) {
    return (
      <Card className="p-5 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--burnt-sienna))" }} />
        <div>
          <p className="font-medium">Activity feed rolling out</p>
          <p className="text-ds-11 text-muted-foreground mt-1">
            Once the platform update finishes deploying, your team's activity will show up here.
          </p>
        </div>
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <Card className="p-8 text-center">
        <EmptyStateIllustration variant="notifications" />
        <p className="font-sans font-semibold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
          No activity yet.
        </p>
        <p className="text-ds-13 text-muted-foreground mt-1.5 max-w-sm mx-auto">
          Once your team starts posting and completing jobs, the timeline will populate here.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {events.map((e, idx) => {
        const actor = e.actor_name || "Someone";
        const amount = e.amount != null ? `$${formatPrice(Number(e.amount))}` : "";
        let icon = <Briefcase className="w-4 h-4" />;
        let verb = "did something with";
        if (e.event_type === "posted") {
          verb = "posted";
          icon = <Briefcase className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />;
        } else if (e.event_type === "completed") {
          verb = "completed";
          icon = <CheckCircle2 className="w-4 h-4" style={{ color: "hsl(var(--olivewood))" }} />;
        }
        return (
          <Card key={`${e.event_at}-${idx}`} className="p-3 flex items-start gap-3">
            <div className="mt-0.5">{icon}</div>
            <div className="flex-1 min-w-0">
              <p className="text-ds-13">
                <span className="font-medium">{actor}</span> {verb}{" "}
                <span className="font-medium">{e.job_title || "a job"}</span>
                {amount && ` for ${amount}`}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-ds-11 text-muted-foreground">
                  {formatDistanceToNow(new Date(e.event_at), { addSuffix: true })}
                </span>
                {e.department && (
                  <Badge variant="sienna" className="text-ds-10">
                    {e.department}
                  </Badge>
                )}
              </div>
            </div>
          </Card>
        );
      })}
      {data?.events && data.events.length >= 30 && (
        <Button
          variant="outline"
          size="sm"
          onClick={loadMore}
          disabled={isFetching}
          className="w-full"
        >
          Load More
        </Button>
      )}
    </div>
  );
}

export default ActivityFeedTab;
