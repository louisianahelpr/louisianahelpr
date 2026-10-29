import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { subscribeWithRecovery, type RecoveringSubscription } from "@/lib/realtimeRecovery";

/**
 * ONE realtime channel per job for the two per-job bindings that the job's tracker (JobTracking) and the chat's
 * job card (DealCard) both need: the job row and its tracking rows. The same shape as the per-user bus
 * (src/lib/userRealtimeBus.ts, Q105): reference-counted (opened with the first listener, closed with the last),
 * a drop recovered once and every listener's `onRecovered` run, so each consumer re-reads what it owns.
 *
 * Before it, JobTracking held the channel on its own; the chat card refreshing with the Working card (audit
 * 2026-10-28, F1) would have been a second copy of the same two subscriptions whenever both were mounted.
 * Guarded by src/test/realtimeChannelInventory.test.ts (no two channels carry the same subscription).
 */

export type JobRealtimeTopic = "tracking" | "job";
export type JobRealtimePayload = RealtimePostgresChangesPayload<Record<string, unknown>>;

interface Listener {
  topic: JobRealtimeTopic;
  onChange: (payload: JobRealtimePayload) => void;
  onRecovered?: () => void;
}

interface Bus {
  listeners: Set<Listener>;
  sub: RecoveringSubscription;
}

const buses = new Map<string, Bus>();

function openBus(jobId: string): Bus {
  const listeners = new Set<Listener>();
  // Copied before iterating: a handler may unsubscribe (unmount) mid-dispatch.
  const dispatch = (topic: JobRealtimeTopic) => (payload: JobRealtimePayload) => {
    for (const l of [...listeners]) {
      if (l.topic !== topic) continue;
      try {
        l.onChange(payload);
      } catch (e) {
        // Not swallowed: re-thrown on a microtask so the global error handler (Sentry) reports it, while the
        // remaining listeners on the shared channel still run.
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
      { event: "*", schema: "public", table: "job_tracking", filter: `job_id=eq.${jobId}` },
      dispatch("tracking"),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${jobId}` },
      dispatch("job"),
    ),
    {
      // The tracker is driven ENTIRELY by other people's writes: a dead channel freezes it mid-job on a step
      // already passed, so every listener re-reads the moment we are back.
      name: `tracking-${jobId}`,
      onRecovered: () => {
        for (const l of [...listeners]) l.onRecovered?.();
      },
    },
  );
  return { listeners, sub };
}

/** Listen to one of this job's shared realtime topics. Returns the unsubscribe. */
export function subscribeJobRealtime(
  jobId: string,
  topic: JobRealtimeTopic,
  onChange: (payload: JobRealtimePayload) => void,
  opts: { onRecovered?: () => void } = {},
): () => void {
  let bus = buses.get(jobId);
  if (!bus) {
    bus = openBus(jobId);
    buses.set(jobId, bus);
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
      if (buses.get(jobId) === b) buses.delete(jobId);
    }
  };
}
