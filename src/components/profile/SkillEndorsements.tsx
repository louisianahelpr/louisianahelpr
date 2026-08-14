import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { hapticLight } from "@/lib/haptics";
import { Plus } from "lucide-react";

interface SkillEndorsementsProps {
  /** The user whose skills to display. */
  profileUserId: string;
  /** The currently signed-in viewer. When null, endorsing is hidden. */
  viewerUserId: string | null;
  /**
   * Whether the viewer has completed at least one job with the profile user.
   * When true, the + endorse button is shown on each pill.
   */
  canEndorse?: boolean;
}

interface HelperSkill {
  id: string;
  skill: string;
  category: string | null;
  endorsement_count: number;
}

/**
 * SkillEndorsements — endorsed skills pills for a helper's public profile.
 *
 * Only shows skills with endorsement_count > 0, ordered by count desc.
 * Past clients who have a completed job with this helper can endorse by
 * tapping + on any pill. Calls endorse_skill() RPC; falls back gracefully
 * on PGRST202 (migration not yet pushed to prod).
 */
export function SkillEndorsements({
  profileUserId,
  viewerUserId,
  canEndorse = false,
}: SkillEndorsementsProps) {
  // Optimistic count bumps — keyed by skill id so we can track which
  // pills have been locally incremented without waiting for a refetch.
  const [optimisticBumps, setOptimisticBumps] = useState<Record<string, number>>({});
  // Track endorsements submitted this session (to hide the + post-tap).
  const [endorsed, setEndorsed] = useState<Set<string>>(new Set());

  const queryClient = useQueryClient();

  const { data: skills = [], isLoading } = useQuery<HelperSkill[]>({
    queryKey: ["helperSkills", profileUserId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("helper_skills")
        .select("id, skill, category, endorsement_count")
        .eq("user_id", profileUserId)
        .gt("endorsement_count", 0)
        .order("endorsement_count", { ascending: false })
        .limit(8);
      if (error) {
        // PGRST202 = table not yet in prod — hide section instead of crash.
        if ((error as any).code === "PGRST202") return [];
        report(error, { tags: { source: "SkillEndorsements.fetch" }, context: { profileUserId } });
        return [];
      }
      return (data ?? []) as HelperSkill[];
    },
  });

  if (isLoading || skills.length === 0) return null;

  const handleEndorse = async (skillId: string) => {
    if (!viewerUserId || endorsed.has(skillId)) return;
    hapticLight();
    // Optimistically increment.
    setOptimisticBumps((prev) => ({ ...prev, [skillId]: (prev[skillId] ?? 0) + 1 }));
    setEndorsed((prev) => new Set(prev).add(skillId));
    try {
      const { error } = await supabase.rpc("endorse_skill", { p_skill_id: skillId });
      if (error) {
        if ((error as any).code === "PGRST202") {
          // Migration not yet pushed — rollback the optimistic bump.
          setOptimisticBumps((prev) => {
            const next = { ...prev };
            delete next[skillId];
            return next;
          });
          setEndorsed((prev) => {
            const next = new Set(prev);
            next.delete(skillId);
            return next;
          });
          return;
        }
        // On other errors: report but keep optimistic state (the bump likely
        // went through via ON CONFLICT DO NOTHING).
        report(error, { tags: { source: "SkillEndorsements.endorse" } });
      }
      // Invalidate so pill counts stay accurate after a background refetch.
      queryClient.invalidateQueries({ queryKey: ["helperSkills", profileUserId] });
    } catch (err) {
      report(err, { tags: { source: "SkillEndorsements.endorse" } });
    }
  };

  return (
    <div className="mt-3 pt-3" style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.12)" }}>
      <p
        className="text-ds-10 font-sans font-semibold uppercase tracking-wide mb-2"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      >
        Skills
      </p>
      <div className="flex flex-wrap gap-1.5 justify-center">
        {skills.map((skill) => {
          const count = skill.endorsement_count + (optimisticBumps[skill.id] ?? 0);
          const alreadyEndorsed = endorsed.has(skill.id);
          const showPlus = canEndorse && viewerUserId && !alreadyEndorsed;
          return (
            <span
              key={skill.id}
              className="inline-flex items-center gap-1 rounded-ds-pill px-2.5 py-1 text-ds-12 font-sans font-semibold"
              style={{
                background: "hsl(var(--bark) / 0.08)",
                color: "hsl(var(--bark))",
                border: "0.5px solid hsl(var(--bark) / 0.18)",
              }}
            >
              {skill.skill}
              <span
                className="tabular-nums opacity-75 text-ds-10"
              >
                · {count}
              </span>
              {showPlus && (
                <button
                  type="button"
                  aria-label={`Endorse ${skill.skill}`}
                  onClick={() => handleEndorse(skill.id)}
                  className="ml-0.5 w-4 h-4 rounded-full flex items-center justify-center transition-opacity active:opacity-60"
                  style={{
                    background: "hsl(var(--bark) / 0.18)",
                  }}
                >
                  <Plus className="w-2.5 h-2.5" strokeWidth={2.5} />
                </button>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
