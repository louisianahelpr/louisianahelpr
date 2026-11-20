/**
 * GET STARTED (owner 11-14: of 37 new members in 14 days, 18 saw Home once and left and none posted a job; "Is there
 * any kind of guide that walks them through to show them how to find or do things"). A checklist on Home, worded from
 * the first run's picks (./firstRunPicks; none picked = every starting step), each step a row that goes straight where
 * it is done. Steps tick themselves from the member's REAL rows (an application, a posted job, a listed item, a saved
 * item, a profile photo, job alerts), never from a tap. One checklist pattern: FirstJobHome's ChecklistProgress, every
 * step shown. "Hide" puts it away for good on this device; it goes when every step is done.
 *
 * Who sees it: a new member on Home's new-member block (`fresh`), and, from then on, for 30 days on that device while
 * steps are left (so ticking the first step does not make the guide vanish with the rest of the welcome).
 * Guard: src/test/newMemberHome1114.test.tsx.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { safeStorage } from "@/lib/safeStorage";
import { useAgeGate } from "@/hooks/useAgeGate";
import { SELL_START_PATH } from "@/lib/declutter/sellChooser";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListRow } from "@/components/ui/ListRow";
import { ICON_STROKE_PX } from "@/lib/iconWeight";
import { useFirstRunPicks, type FirstRunPick } from "@/components/firstRun/firstRunPicks";
import { ChecklistProgress } from "./FirstJobHome";
import "@/lib/i18n/enHome";
import "@/lib/i18n/enNewMember";
import { useLanguage } from "@/lib/i18n/language";

const GUIDE_DAYS = 30;
export const getStartedKey = (userId: string) => `helpr_get_started_${userId}`;
type GuideState = { startedAt: number; dismissed?: boolean };

function readState(userId: string): GuideState | null {
  try {
    const raw = safeStorage.getItem(getStartedKey(userId));
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof (v as GuideState).startedAt === "number" ? (v as GuideState) : null;
  } catch {
    return null; // blocked or malformed storage: treated as never started
  }
}
function writeState(userId: string, s: GuideState) {
  try {
    safeStorage.setItem(getStartedKey(userId), JSON.stringify(s));
  } catch {
    /* best-effort: without it the guide shows only while Home's new-member block does */
  }
}

type GuideStepKey = "apply" | "post" | "list" | "save" | "photo" | "alerts";
interface GuideFacts { applied: boolean; posted: boolean; listed: boolean; saved: boolean; photo: boolean; alertsOn: boolean }

/** The steps for these picks, in order: the picked ones first (in the picker's order), then photo and alerts. */
export function guideSteps(picks: FirstRunPick[], declutterOpen: boolean): GuideStepKey[] {
  const by: Record<FirstRunPick, GuideStepKey> = { earn: "apply", hire: "post", sell: "list", deal: "save" };
  const chosen = (picks.length ? picks : (["earn", "sell", "hire"] as FirstRunPick[]))
    .filter((p) => declutterOpen || (p !== "sell" && p !== "deal"))
    .map((p) => by[p]);
  const out: GuideStepKey[] = chosen.length ? chosen : ["apply", "post"];
  out.push("photo");
  // Job alerts help whoever came to find work (or picked nothing): they tell them about new jobs near them.
  if (picks.length === 0 || picks.includes("earn")) out.push("alerts");
  return out;
}

const DONE: Record<GuideStepKey, (f: GuideFacts) => boolean> = {
  apply: (f) => f.applied,
  post: (f) => f.posted,
  list: (f) => f.listed,
  save: (f) => f.saved,
  photo: (f) => f.photo,
  alerts: (f) => f.alertsOn,
};

/** The member's real rows behind each tick: head counts only (RLS: a member reads their own). */
function useGuideFacts(userId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["home", "get-started", userId],
    enabled: enabled && !!userId,
    queryFn: async () => {
      const id = userId!;
      const head = { count: "exact" as const, head: true };
      const [apps, posted, listed, saved] = await Promise.all([
        supabase.from("applications").select("id", head).eq("helper_id", id),
        supabase.from("jobs").select("id", head).eq("customer_id", id),
        supabase.from("declutter_items").select("id", head).eq("seller_id", id).neq("status", "draft"),
        supabase.from("declutter_watchlist").select("item_id", head).eq("user_id", id),
      ]);
      const n = (r: { count: number | null; error: { message: string } | null; status: number }) => unwrap({ data: r.count, error: r.error, status: r.status }) ?? 0;
      return { applied: n(apps) > 0, posted: n(posted) > 0, listed: n(listed) > 0, saved: n(saved) > 0 };
    },
  });
}

export function GetStartedGuide({ userId, fresh, declutterOpen, hasPhoto, alertsOff }: {
  userId: string | undefined;
  /** Home's new-member block is showing: the guide starts (and is remembered on this device). */
  fresh: boolean;
  declutterOpen: boolean;
  hasPhoto: boolean;
  /** Job alerts are off on both channels (useFirstJobState); null while that read is out. */
  alertsOff: boolean | null;
}) {
  const navigate = useNavigate();
  const gate = useAgeGate();
  const { t } = useLanguage();
  const picks = useFirstRunPicks(userId);
  const [state, setState] = useState<GuideState | null>(() => (userId ? readState(userId) : null));
  useEffect(() => {
    if (!userId) return;
    const s = readState(userId);
    if (!s && fresh) {
      const started = { startedAt: Date.now() };
      writeState(userId, started);
      setState(started);
    } else setState(s);
  }, [userId, fresh]);
  const recent = !!state && Date.now() - state.startedAt < GUIDE_DAYS * 86_400_000;
  const shown = !!userId && !state?.dismissed && (fresh || recent);
  const facts = useGuideFacts(userId, shown);
  const keys = useMemo(() => guideSteps(picks, declutterOpen), [picks, declutterOpen]);

  if (!shown) return null;
  if (!facts.data || alertsOff === null) {
    // Hold the checklist's own height while its reads are out, so the strips below never move when it lands.
    return <div data-get-started-loading="" aria-hidden className="px-1" style={{ minHeight: 40 + 44 * keys.length }} />;
  }
  const f: GuideFacts = { ...facts.data, photo: hasPhoto, alertsOn: !alertsOff };
  const go: Record<GuideStepKey, () => void> = {
    apply: () => navigate("/jobs"),
    post: gate.gate("post", () => navigate("/post-job")),
    list: () => navigate(SELL_START_PATH),
    save: () => navigate("/declutter"),
    photo: () => navigate("/profile?tab=profile"),
    alerts: () => navigate("/profile?tab=notifications"),
  };
  const steps = keys.map((k) => ({ key: k, label: t(`home.gs.${k}`), done: DONE[k](f), go: go[k] }));
  if (steps.every((s) => s.done)) return null;
  const hide = () => {
    const next = { startedAt: state?.startedAt ?? Date.now(), dismissed: true };
    writeState(userId!, next);
    setState(next);
  };
  return (
    <section data-testid="get-started" aria-label={t("home.gs.title")} className="liquid-glass p-card">
      <ChecklistProgress
        title={t("home.gs.title")}
        steps={steps}
        rows={
          <ul className="mt-1 flex flex-col">
            {steps.map((s) => (
              <li key={s.key}>
                <ListRow onClick={s.go} data-checklist-step={s.key} data-done={s.done ? "" : undefined} className="justify-start gap-2.5 rounded-lg px-1 text-ds-14">
                  <span aria-hidden className={`h-5 w-5 shrink-0 rounded-full flex items-center justify-center ${s.done ? "bg-primary" : "border-[1.5px] border-border"}`}>
                    {/* lucide's check, drawn here: importing the Check icon moved it between the shared icon chunks
                        and every route's first load grew (/admin, /profile; critical-path budget, 11-14). */}
                    {s.done && <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE_PX} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 text-primary-foreground"><path d="M20 6 9 17l-5-5" vectorEffect="non-scaling-stroke" /></svg>}
                  </span>
                  <span className={`min-w-0 flex-1 ${s.done ? "text-muted-foreground line-through" : "font-semibold text-foreground"}`}>
                    {s.label}
                    {s.done && <span className="sr-only"> · {t("home.gs.done")}</span>}
                  </span>
                  {!s.done && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                </ListRow>
              </li>
            ))}
          </ul>
        }
        trailing={
          <Button type="button" variant="link" size="sm" data-get-started-hide="" aria-label={t("home.gs.hideAria")} onClick={hide} className="px-1 -my-2 text-ds-13 font-semibold text-muted-foreground">
            {t("home.gs.hide")}
          </Button>
        }
      />
    </section>
  );
}
