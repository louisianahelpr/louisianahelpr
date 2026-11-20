import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/components/admin/adminRpcErrorCopy";
import { formatShortDate } from "@/lib/format";
import { AdminCard } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { InlineTextButton } from "@/components/ui/InlineTextButton";
import { isMissingRpcNamed } from "@/lib/missingRpc";

/**
 * App sign-ins this week (owner 2026-11-20: "add an app download feature ... and do your best to say which people it
 * came from", for a possible 25 Days bonus entry). Apple and Google never say who downloaded the app, so this shows
 * who SIGNED IN on the iOS or Android app (public.app_installs, migration 20261120150247): counts by platform, new
 * (first app sign-in in the last 7 days) vs returning, and the new members, newest first. Test and seed accounts
 * never count. Read through admin_app_signins_week(), admin only; the table itself is server-only.
 *
 * App Store download COUNTS (not names) need an App Store Connect API key the owner creates; see
 * docs/app-store-connect-downloads.md. Nothing here reads App Store Connect yet.
 */
type NewMember = {
  user_id: string;
  name: string | null;
  town: string | null;
  platform: "ios" | "android";
  first_seen_at: string;
};

type Week = {
  ios_new: number;
  ios_returning: number;
  android_new: number;
  android_returning: number;
  new_members: NewMember[];
};

type WeekLoad = { unavailable: true } | { unavailable: false; week: Week };

/** Rows shown before "Show all". */
const PREVIEW = 10;

const appSignInsQueryKey = ["admin", "app-sign-ins-week"] as const;

async function loadWeek(): Promise<WeekLoad> {
  const res = await supabase.rpc("admin_app_signins_week");
  // PGRST202: not deployed yet (db-deploy lag after merge). Said on the card, never shown as "nobody".
  if (isMissingRpcNamed(res.error, "admin_app_signins_week")) return { unavailable: true };
  const w = (unwrap(res) ?? {}) as Partial<Week>;
  return {
    unavailable: false,
    week: {
      ios_new: Number(w.ios_new ?? 0),
      ios_returning: Number(w.ios_returning ?? 0),
      android_new: Number(w.android_new ?? 0),
      android_returning: Number(w.android_returning ?? 0),
      new_members: Array.isArray(w.new_members) ? w.new_members : [],
    },
  };
}

const PLATFORM_LABEL: Record<NewMember["platform"], string> = { ios: "iPhone", android: "Android" };

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/40 px-3 py-2">
      <p className="font-mono text-ds-18 font-semibold tabular-nums text-foreground leading-none">{value}</p>
      <p className="mt-1 text-ds-11 text-muted-foreground">{label}</p>
    </div>
  );
}

function MemberRow({ m }: { m: NewMember }) {
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <p className="text-ds-13 font-medium text-foreground break-words">{m.name?.trim() || "No name yet"}</p>
      <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-ds-11 text-muted-foreground tabular-nums">
        <span>{m.town?.trim() || "No town"}</span>
        <span>{PLATFORM_LABEL[m.platform] ?? m.platform}</span>
        <span>First signed in {formatShortDate(m.first_seen_at)}</span>
      </p>
    </li>
  );
}

export function AppSignInsCard() {
  const [showAll, setShowAll] = useState(false);
  const q = useQuery({ queryKey: appSignInsQueryKey, queryFn: loadWeek, staleTime: 60_000 });
  const title = (
    <span className="flex items-center gap-2">
      <Smartphone className="w-4 h-4 text-primary" /> App sign-ins this week
    </span>
  );
  const subtitle = "Members who signed in on the iPhone or Android app in the last 7 days";

  if (q.isPending) {
    return (
      <AdminCard title={title} subtitle={subtitle}>
        <div className="flex justify-center py-6" role="status" aria-label="Loading app sign-ins">
          <HelprSpinner size={20} />
        </div>
      </AdminCard>
    );
  }
  if (q.isError) {
    return (
      <AdminCard title={title} subtitle={subtitle}>
        <ErrorState
          variant="inline"
          title="Couldn't load app sign-ins"
          body={rpcErrorMessage("admin_app_signins_week", q.error) ?? "Check your connection and try again."}
          onRetry={() => void q.refetch()}
          surfaceStyle={NESTED_EMPTY_SURFACE}
        />
      </AdminCard>
    );
  }
  if (q.data.unavailable) {
    return (
      <AdminCard title={title} subtitle={subtitle}>
        <p className="text-ds-13 text-muted-foreground">
          Not available yet: app sign-ins start showing once their database update finishes deploying.
        </p>
      </AdminCard>
    );
  }

  const w = q.data.week;
  const rows = w.new_members;
  const shown = showAll ? rows : rows.slice(0, PREVIEW);

  return (
    <AdminCard title={title} subtitle={subtitle}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="New on iPhone" value={w.ios_new} />
        <Stat label="Returning on iPhone" value={w.ios_returning} />
        <Stat label="New on Android" value={w.android_new} />
        <Stat label="Returning on Android" value={w.android_returning} />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={Smartphone}
          variant="inline"
          title="No new app sign-ins this week"
          body="A member's first sign-in on the iPhone or Android app shows here, with their town and the day."
          surfaceStyle={NESTED_EMPTY_SURFACE}
        />
      ) : (
        <>
          <p className="mt-4 text-ds-11 font-semibold uppercase tracking-wide text-muted-foreground">
            First app sign-in this week
          </p>
          <ul className="mt-2 divide-y divide-border/60">
            {shown.map((m) => (
              <MemberRow key={m.user_id} m={m} />
            ))}
          </ul>
          {rows.length > PREVIEW && (
            <InlineTextButton onClick={() => setShowAll((v) => !v)} className="mt-3 text-ds-13 font-medium text-primary">
              {showAll ? "Show fewer" : `Show all ${rows.length}`}
            </InlineTextButton>
          )}
        </>
      )}
    </AdminCard>
  );
}
