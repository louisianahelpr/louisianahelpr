import {
  BadgeCheck,
  CheckCircle2,
  CircleSlash,
  Info,
  MapPin,
  Navigation,
  PlayCircle,
  RotateCcw,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import type { JobSystemEventKind } from "@/lib/jobSystemEvents";

/**
 * ONE treatment for every "the app is speaking" row in a thread.
 *
 * A thread can be told about a job transition by two independent mechanisms,
 * and both were rendering their own way on the same screen:
 *
 *   - `jobSystemEvents`, derived from the job's transition timestamps
 *     (src/lib/jobSystemEvents.ts) → a bordered pill with a time under it.
 *   - stored `is_system` message rows, written by the job-status trigger
 *     (supabase/migrations/…_fix_job_status_trigger_null_sender.sql) → bare
 *     centred italic text, prefixed with a literal glyph baked into the DB
 *     content: `✓ Job awarded`, `▶ Work started`, `✕ Job cancelled`.
 *
 * So the same class of fact ("this job moved on") appeared as a pill in one
 * row and as loose emoji-led text in the next, which reads as two different
 * kinds of thing. The glyphs are also off-brand: this app draws its
 * iconography with Lucide strokes in the olive/sienna palette, not with
 * emoji the OS renders in its own colours.
 *
 * Both sources now render through this component: a Lucide icon at the same
 * weight as the rest of the app, the sentence, and — when we have one — the
 * time. The stored rows keep their wording (it is what both participants have
 * always seen) minus the glyph, which is mapped to the matching icon instead.
 */

/** Icon per derived-event kind. Exhaustive by type — a new kind won't build. */
const EVENT_ICONS: Record<JobSystemEventKind, LucideIcon> = {
  helper_on_the_way: Navigation,
  helper_arrived: MapPin,
  helper_completed: CheckCircle2,
  poster_confirmed_completed: BadgeCheck,
  revision_requested: RotateCcw,
  cancelled: CircleSlash,
  disputed: ShieldAlert,
};

export function iconForEventKind(kind: JobSystemEventKind): LucideIcon {
  return EVENT_ICONS[kind];
}

/**
 * Leading run of non-letter, non-digit characters — the `✓ ` / `▶ ` / `✕ ` /
 * `⚠ ` prefixes the DB trigger writes, plus any emoji-presentation variant
 * (`▶️`) or stray spacing around them.
 *
 * Stripped at RENDER rather than migrated in the database on purpose: rows
 * already written to `public.messages` carry the glyph, so a trigger-only
 * change would fix new threads and leave every existing one mixed. Doing it
 * here covers both, and the trigger's copy stays the single source of the
 * wording.
 */
const LEADING_GLYPHS = /^[^\p{L}\p{N}]+/u;

/** Keyword → icon for stored system rows, matched against the stripped text.
 *  Order matters: "Job completed" must not be caught by a broader rule. */
const STORED_ICON_RULES: { matches: RegExp; icon: LucideIcon }[] = [
  { matches: /\bawarded\b/i, icon: BadgeCheck },
  { matches: /\bstarted\b/i, icon: PlayCircle },
  { matches: /\bcomplete/i, icon: CheckCircle2 },
  { matches: /\bcancell?ed\b/i, icon: CircleSlash },
  { matches: /\bdisput/i, icon: ShieldAlert },
];

/** Turn a stored `is_system` message body into label + icon. */
export function normalizeStoredSystemMessage(content: string | null | undefined): {
  label: string;
  icon: LucideIcon;
} {
  const label = (content ?? "").replace(LEADING_GLYPHS, "").trim();
  const rule = STORED_ICON_RULES.find((r) => r.matches.test(label));
  return { label, icon: rule?.icon ?? Info };
}

export function SystemEventRow({
  icon: Icon,
  label,
  at,
}: {
  icon: LucideIcon;
  label: string;
  /** ISO timestamp. Derived events carry one; stored rows are placed by their
   *  own `created_at` in the timeline and don't repeat it. */
  at?: string;
}) {
  return (
    <div className="flex justify-center py-0.5">
      {/* Compact pill — was full-size bubble padding/text, which made a
          one-line status note ("Helpr marked on the way.") read as heavy as
          a real message bubble. Tightened padding + type scale, timestamp
          folded inline instead of stacked on its own row, so the pill stays
          legible but visibly lighter-weight than a chat message. */}
      <div
        role="note"
        aria-label={`System update: ${label}`}
        className="max-w-[80%] px-2.5 py-1 rounded-full text-center"
        style={{
          background: "hsl(var(--ivory-sand) / 0.55)",
          border: "0.5px solid hsl(var(--olivewood) / 0.18)",
          boxShadow: "inset 0 1px 1px 0 rgba(255, 255, 255, 0.6)",
        }}
      >
        <p
          className="font-serif italic text-ds-10 leading-snug inline-flex items-center gap-1"
          style={{ color: "hsl(var(--olivewood) / 0.85)" }}
        >
          <Icon
            aria-hidden="true"
            className="w-3 h-3 shrink-0"
            strokeWidth={1.75}
            style={{ color: "hsl(var(--bark))" }}
          />
          {label}
          {at && (
            <span
              className="font-sans uppercase tracking-wider text-ds-9"
              style={{
                letterSpacing: "0.1em",
                color: "hsl(var(--olivewood) / 0.7)",
              }}
            >
              ·{" "}
              {new Date(at).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              })}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
