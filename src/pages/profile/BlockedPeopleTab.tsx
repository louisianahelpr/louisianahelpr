import { useQuery } from "@tanstack/react-query";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import { ProfileTabBodyReserve } from "@/components/profile/ProfileTabFallback";
import { ErrorState } from "@/components/ui/ErrorState";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { unwrap } from "@/lib/supabaseResult";
import { formatName } from "@/lib/utils";
import { useUnblock } from "@/pages/user/useUnblock";
import { TAB_TITLES } from "@/pages/profile/types";

const card = { background: "hsl(var(--card))" } as const;

/** Shown for someone you blocked whose profile is gone (deleted or removed). */
export const GONE_NAME = "A deleted account";

export type BlockedPerson = { id: string; name: string };

export const blockedPeopleKey = (me: string) => ["settings-blocked-people", me] as const;

/**
 * The people this member blocked, newest first, named the way the rest of
 * the app names a member (get_safe_profiles: "First L."). Only the blocker's
 * own rows: user_blocks RLS lets a member read rows they are part of, and this
 * asks for blocker_id = me.
 */
export async function fetchBlockedPeople(me: string): Promise<BlockedPerson[]> {
  const rows = unwrap(
    await supabase
      .from("user_blocks")
      .select("blocked_id, created_at")
      .eq("blocker_id", me)
      .order("created_at", { ascending: false }),
  ) ?? [];
  const ids = [...new Set(rows.map((r) => r.blocked_id))];
  if (ids.length === 0) return [];
  const profiles = unwrap(await supabase.rpc("get_safe_profiles", { user_ids: ids })) ?? [];
  const byId = new Map(profiles.map((p) => [p.user_id, p.full_name]));
  return ids.map((id) => ({ id, name: byId.has(id) ? formatName(byId.get(id), GONE_NAME) : GONE_NAME }));
}

function BlockedRow({ me, person }: { me: string; person: BlockedPerson }) {
  const { unblocking, handleUnblock } = useUnblock(me, person.id, blockedPeopleKey(me));
  return (
    <li className="flex items-center gap-3 pl-4 pr-2 py-2 min-h-[60px] border-b border-border last:border-b-0" data-blocked-person={person.id}>
      <span className="flex-1 min-w-0 font-sans font-semibold text-ds-15 truncate" style={{ color: "hsl(var(--ink-deep))" }}>
        {person.name}
      </span>
      <button
        type="button"
        onClick={() => void handleUnblock()}
        disabled={unblocking}
        aria-label={`Unblock ${person.name}`}
        className="btn-press shrink-0 min-h-11 px-4 rounded-full border text-ds-14 font-semibold text-foreground disabled:opacity-60"
        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}
      >
        {unblocking ? "Unblocking…" : "Unblock"}
      </button>
    </li>
  );
}

/**
 * You › Settings › Blocked people (A3-C16, app audit 2026-10-29). Unblocking
 * was only possible from the blocked person's own profile, which a member
 * could no longer find (a block hides them everywhere). This lists them with
 * an Unblock button each, using the same useUnblock the profile uses.
 */
export default function BlockedPeopleTab({ onBack }: { onBack: () => void }) {
  const { user } = useCurrentUser();
  const me = user?.id ?? "";
  const list = useQuery({ queryKey: blockedPeopleKey(me), enabled: !!me, queryFn: () => fetchBlockedPeople(me) });
  const rows = list.data ?? [];
  return (
    <ProfileTabBody data-testid="blocked-people-tab">
      <ProfileTabHeader title={TAB_TITLES.blocked} onBack={onBack} />
      {list.isLoading ? (
        <ProfileTabBodyReserve tab="blocked" />
      ) : list.isError ? (
        <ErrorState variant="inline" title="We couldn't load the people you blocked." onRetry={() => void list.refetch()} />
      ) : (
        <>
          <p className="font-sans text-ds-13 text-muted-foreground px-1">
            {rows.length
              ? "They can't message you or apply to your jobs, and you won't see their messages, applications or profile."
              : "You haven't blocked anyone. You can block someone from the menu on their profile."}
          </p>
          {rows.length > 0 && (
            <ul className="rounded-2xl overflow-hidden" style={card}>
              {rows.map((p) => (
                <BlockedRow key={p.id} me={me} person={p} />
              ))}
            </ul>
          )}
        </>
      )}
    </ProfileTabBody>
  );
}
