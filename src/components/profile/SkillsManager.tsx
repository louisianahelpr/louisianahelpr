import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { hapticLight } from "@/lib/haptics";
import { categorySkills, universalSkills } from "@/lib/skillsGuide";
import { formatCategory } from "@/lib/format";
import { X, Plus, ChevronDown } from "lucide-react";
import { toast } from "sonner";

const MAX_SKILLS = 10;

interface HelperSkill {
  id: string;
  skill: string;
  category: string | null;
  endorsement_count: number;
}

interface SkillsManagerProps {
  userId: string;
}

/**
 * SkillsManager — the "Your skills" panel shown on the helper's own profile
 * (ProfileLanding). Lets them add up to 10 skills from the predefined map.
 */
export function SkillsManager({ userId }: SkillsManagerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("other");
  const queryClient = useQueryClient();

  const { data: skills = [], isLoading } = useQuery<HelperSkill[]>({
    queryKey: ["helperSkills", userId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("helper_skills")
        .select("id, skill, category, endorsement_count")
        .eq("user_id", userId)
        .order("endorsement_count", { ascending: false });
      if (error) {
        if ((error as any).code === "PGRST202") return [];
        report(error, { tags: { source: "SkillsManager.fetch" } });
        return [];
      }
      return (data ?? []) as HelperSkill[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (skill: string) => {
      const { error } = await supabase.from("helper_skills").insert({
        user_id: userId,
        skill,
        category: selectedCategory,
      });
      if (error) {
        if ((error as any).code === "23505") throw new Error("already_exists");
        if ((error as any).code === "PGRST202") throw new Error("not_deployed");
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["helperSkills", userId] });
      toast.success("Skill added!");
      setPickerOpen(false);
    },
    onError: (err: Error) => {
      if (err.message === "already_exists") {
        toast.error("You already have that skill.");
      } else if (err.message === "not_deployed") {
        toast.error("Skills will be available soon.");
      } else {
        report(err, { tags: { source: "SkillsManager.add" } });
        toast.error("Couldn't add skill. Try again.");
      }
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (skillId: string) => {
      const { error } = await supabase
        .from("helper_skills")
        .delete()
        .eq("id", skillId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["helperSkills", userId] });
      toast.success("Skill removed.");
    },
    onError: (err) => {
      report(err, { tags: { source: "SkillsManager.remove" } });
      toast.error("Couldn't remove skill. Try again.");
    },
  });

  // All available skill names not already added.
  const existingNames = new Set(skills.map((s) => s.skill));
  const allAvailable = [
    ...(categorySkills[selectedCategory] ?? []),
    ...universalSkills,
  ].filter((s, i, arr) => arr.indexOf(s) === i).filter((s) => !existingNames.has(s));

  const atMax = skills.length >= MAX_SKILLS;

  return (
    <div className="mt-3.5 pt-3.5" style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.10)" }}>
      <div className="flex items-center justify-between mb-2">
        <p
          className="font-serif italic uppercase text-ds-9"
          style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
        >
          Your skills
        </p>
        {!atMax && (
          <button
            type="button"
            onClick={() => { hapticLight(); setPickerOpen((o) => !o); }}
            className="inline-flex items-center gap-1 text-ds-11 font-semibold active:opacity-70 transition-opacity"
            style={{ color: "hsl(var(--bark))" }}
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            Add skill
            <ChevronDown className={`w-3 h-3 transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
          </button>
        )}
        {atMax && (
          <span className="text-ds-10 font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Max {MAX_SKILLS} skills
          </span>
        )}
      </div>

      {/* Current skills */}
      {!isLoading && skills.length === 0 && (
        <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Add skills so clients know what you're great at.
        </p>
      )}
      {skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {skills.map((skill) => (
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
              {skill.endorsement_count > 0 && (
                <span className="tabular-nums opacity-75" style={{ fontSize: "0.65rem" }}>
                  · {skill.endorsement_count}
                </span>
              )}
              <button
                type="button"
                aria-label={`Remove ${skill.skill}`}
                disabled={removeMutation.isPending}
                onClick={() => { hapticLight(); removeMutation.mutate(skill.id); }}
                className="ml-0.5 w-4 h-4 rounded-full flex items-center justify-center transition-opacity active:opacity-60 disabled:opacity-40"
                style={{ background: "hsl(var(--bark) / 0.16)" }}
              >
                <X className="w-2.5 h-2.5" strokeWidth={2.5} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Picker */}
      {pickerOpen && !atMax && (
        <div
          className="mt-3 rounded-ds-md p-3 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-150"
          style={{
            background: "hsla(0, 0%, 100%, 0.55)",
            border: "0.5px solid hsl(var(--bark) / 0.16)",
          }}
        >
          {/* Category filter */}
          <div className="flex flex-wrap gap-1">
            {Object.keys(categorySkills).slice(0, 8).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className="px-2 py-0.5 rounded-full text-ds-10 font-sans font-semibold transition-colors"
                style={{
                  color: selectedCategory === cat ? "hsl(var(--parchment))" : "hsl(var(--bark))",
                  background: selectedCategory === cat ? "hsl(var(--bark))" : "hsl(var(--bark) / 0.08)",
                  border: `0.5px solid hsl(var(--bark) / ${selectedCategory === cat ? "0.6" : "0.18"})`,
                }}
              >
                {formatCategory(cat)}
              </button>
            ))}
          </div>

          {/* Skill chips to add */}
          {allAvailable.length === 0 ? (
            <p className="font-serif italic text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              All skills in this category already added.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {allAvailable.map((skillName) => (
                <button
                  key={skillName}
                  type="button"
                  disabled={addMutation.isPending}
                  onClick={() => { hapticLight(); addMutation.mutate(skillName); }}
                  className="inline-flex items-center gap-1 rounded-ds-pill px-2.5 py-1 text-ds-12 font-sans font-semibold transition-all active:scale-95 disabled:opacity-60"
                  style={{
                    background: "hsl(var(--bark) / 0.05)",
                    color: "hsl(var(--bark))",
                    border: "0.5px dashed hsl(var(--bark) / 0.25)",
                  }}
                >
                  <Plus className="w-2.5 h-2.5" strokeWidth={2.5} />
                  {skillName}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
