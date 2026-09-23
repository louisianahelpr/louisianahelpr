import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { subscribeWithRecovery, type RecoveringSubscription } from "@/lib/realtimeRecovery";

/**
 * ONE realtime channel per signed-in user for the user-scoped bindings that
 * several screens need at once (docs/OPEN.md Q105).
 *
 * WHY THIS EXISTS. Realtime was the largest single DB cost after the Q53
 * outage (realtime.list_changes 35% of all SQL time), and it scales with the
 * number of `realtime.subscription` rows — one per binding per open channel.
 * Four consumers each opened their OWN channel carrying the identical
 * `notifications` INSERT `user_id=eq.<me>` binding: the nav badges
 * (useActivityBadgeCounts, mounted on every signed-in page), every mounted
 * bell (NotificationPanel), Dashboard's browser-push hook (useRealtimePush)
 * and Activity (useActivityData). Two of them also each bound `jobs`
 * `customer_id=eq.<me>` and `applications` `helper_id=eq.<me>`, and the nav
 * unread badge and the Messages page both bound `messages` `receiver_id=eq.<me>`. Measured from
 * source on Activity (nav + one bell + Activity): 10 subscription rows on 4
 * channels, of which 5 were byte-identical duplicates.
 *
 * Every binding here is server-side filtered to the user, and the channel is
 * reference-counted: opened with the first listener, closed with the last.
 * A drop is recovered once (subscribeWithRecovery) and every listener's own
 * `onRecovered` runs, so each consumer still re-reads what it owns.
 *
 * Guarded by src/test/realtimeChannelInventory.test.ts (the exact channel
 * inventory, and that no other file re-binds one of these four).
 */

export type UserRealtimeTopic = "notifications:insert" | "jobs:customer" | "applications:helper" | "messages:inbound";
export type UserRealtimePayload = RealtimePostgresChangesPayload<Record<string, unknown>>;

interface Listener {
  topic: UserRealtimeTopic;
  onChange: (payload: UserRealtimePayload) => void;
  onRecovered?: () => void;
}

interface Bus {
  listeners: Set<Listener>;
  sub: RecoveringSubscription;
}

const buses = new Map<string, Bus>();

function openBus(userId: string): Bus {
  const listeners = new Set<Listener>();
  // Copied before iterating: a handler may unsubscribe (unmount) mid-dispatch.
  const dispatch = (topic: UserRealtimeTopic) => (payload: UserRealtimePayload) => {
    for (const l of [...listeners]) {
      if (l.topic !== topic) continue;
      // One consumer's throw must not starve the others on the shared channel
      // (each had its own channel before Q105). Re-thrown on a microtask so the
      // global error handler (Sentry) still sees it.
      try {
        l.onChange(payload);
      } catch (e) {
        // Not swallowed: re-thrown on a microtask so the global error handler
        // (Sentry) reports it, while the remaining listeners still run.
        queueMicrotask(() => {
          throw e;
        });
      }
    }
  };
  const sub = subscribeWithRecovery(
    (name) => supabase
    .channel(name)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      dispatch("notifications:insert"),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "jobs", filter: `customer_id=eq.${userId}` },
      dispatch("jobs:customer"),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "applications", filter: `helper_id=eq.${userId}` },
      dispatch("applications:helper"),
    )
    // Every change to a message I RECEIVE (Q105 follow-up). The nav unread
    // badge (useNavUnreadCount, mounted on every signed-in page) recounts on
    // any of them; the Messages page reads the INSERT and UPDATE ones by
    // `payload.eventType`. Before this, each bound it on its own channel, so
    // with Messages open every inbound message was two subscription rows.
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages", filter: `receiver_id=eq.${userId}` },
      dispatch("messages:inbound"),
    ),
    {
      name: `user-realtime-${userId}`,
      onRecovered: () => {
        for (const l of [...listeners]) l.onRecovered?.();
      },
    },
  );
  return { listeners, sub };
}

/**
 * Listen to one of this user's shared realtime topics. Returns the
 * unsubscribe; the underlying channel closes when its last listener leaves.
 */
export function subscribeUserRealtime(
  userId: string,
  topic: UserRealtimeTopic,
  onChange: (payload: UserRealtimePayload) => void,
  opts: { onRecovered?: () => void } = {},
): () => void {
  let bus = buses.get(userId);
  if (!bus) {
    bus = openBus(userId);
    buses.set(userId, bus);
  }
  const b = bus;
  const listener: Listener = { topic, onChange, onRecovered: opts.onRecovered };
  b.listeners.add(listener);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    b.listeners.delete(listener);
    if (b.listeners.size === 0) {
      b.sub.close();
      if (buses.get(userId) === b) buses.delete(userId);
    }
  };
}
