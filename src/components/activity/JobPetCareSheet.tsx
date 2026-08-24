import { useQuery } from "@tanstack/react-query";
import { PawPrint, Stethoscope, Utensils, Phone, AlertTriangle, Pill } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

/**
 * The care sheet for the pets on a job — the END of the flow PetPicker starts.
 *
 * Before this, `pet_profiles` was owner-only RLS and nothing joined a pet to a
 * job, so a sitter arrived knowing the address and the time and nothing about
 * the animal: not what it eats, not what it takes, not who its vet is. The
 * poster had filled all of that in; it just had nowhere to go.
 *
 * Reads through `get_job_pets` (migration 20260823160000), which authorises the
 * poster or the ASSIGNED helper and returns care fields only — no owner id, no
 * evacuation registration. An applicant gets `not_authorized`; that is the
 * point, so the query is only mounted once the job is actually somebody's.
 *
 * Self-hiding: a job with no pets attached renders nothing, so this can be
 * mounted on any accepted job without gating on category at the call site.
 */
type JobPet = {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  age_years: number | null;
  weight_lbs: number | null;
  color_markings: string | null;
  photo_url: string | null;
  feeding_schedule: string | null;
  medical_notes: string | null;
  behavioral_notes: string | null;
  vet_name: string | null;
  vet_phone: string | null;
  emergency_contact: string | null;
  microchip_id: string | null;
};

const Line = ({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof PawPrint;
  label: string;
  value: string;
  tone?: "warn";
}) => (
  <div className="flex items-start gap-2">
    <Icon
      className="w-3.5 h-3.5 shrink-0 mt-0.5"
      style={{ color: tone === "warn" ? "hsl(var(--amber-ink))" : "hsl(var(--petcare-ink))" }}
      aria-hidden
    />
    <p className="text-ds-11 min-w-0" style={{ color: "hsl(var(--ink-deep))" }}>
      <span className="font-semibold">{label}: </span>
      <span style={{ color: "hsl(var(--olivewood))" }}>{value}</span>
    </p>
  </div>
);

export function JobPetCareSheet({ jobId }: { jobId: string }) {
  const { data: pets, isError, error } = useQuery({
    queryKey: ["job_pets", jobId],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error: rpcErr } = await supabase.rpc("get_job_pets" as never, {
        p_job_id: jobId,
      } as never);
      // PGRST202 = the migration has merged but db-deploy has not finished.
      // Expected for a few minutes on every deploy; render nothing rather than
      // an error state on a card that is otherwise fine.
      if (rpcErr) {
        if (rpcErr.code === "PGRST202") return [];
        throw rpcErr;
      }
      return (data ?? []) as JobPet[];
    },
  });

  if (isError) report(error, { tags: { source: "JobPetCareSheet.get_job_pets" } });
  if (!pets || pets.length === 0) return null;

  return (
    <div
      className="rounded-ds-md p-3 space-y-3"
      style={{
        background: "hsl(var(--petcare-ink) / 0.06)",
        border: "0.5px solid hsl(var(--petcare-ink) / 0.22)",
      }}
    >
      <p
        className="font-serif italic uppercase inline-flex items-center gap-1.5 text-ds-10"
        style={{ color: "hsl(var(--petcare-ink))", letterSpacing: "0.18em" }}
      >
        <PawPrint className="w-3 h-3" />
        {pets.length === 1 ? "Your charge" : `Your charges · ${pets.length}`}
      </p>

      {pets.map((p) => {
        const meta = [
          p.breed,
          p.species,
          p.age_years != null ? `${p.age_years}y` : null,
          p.weight_lbs != null ? `${p.weight_lbs} lb` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <div key={p.id} className="flex items-start gap-3">
            {p.photo_url ? (
              <img
                src={p.photo_url}
                alt=""
                aria-hidden
                className="w-11 h-11 rounded-ds-md object-cover shrink-0"
              />
            ) : (
              <span
                className="w-11 h-11 rounded-ds-md shrink-0 inline-flex items-center justify-center"
                style={{ background: "hsl(var(--petcare-ink) / 0.12)" }}
                aria-hidden
              >
                <PawPrint className="w-5 h-5" style={{ color: "hsl(var(--petcare-ink))" }} />
              </span>
            )}
            <div className="min-w-0 flex-1 space-y-1.5">
              <p
                className="font-display italic font-bold leading-tight text-ds-15"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
              >
                {p.name}
                {meta && (
                  <span
                    className="font-serif italic font-normal ml-2 text-ds-11"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  >
                    {meta}
                  </span>
                )}
              </p>
              {/* MEDICAL FIRST. The order here is the order somebody standing in
                  a stranger's kitchen needs it: what could go wrong, what it
                  eats, how it behaves, then who to call. */}
              {p.medical_notes && <Line icon={Pill} label="Medical" value={p.medical_notes} tone="warn" />}
              {p.feeding_schedule && <Line icon={Utensils} label="Feeding" value={p.feeding_schedule} />}
              {p.behavioral_notes && <Line icon={AlertTriangle} label="Behaviour" value={p.behavioral_notes} />}
              {(p.vet_name || p.vet_phone) && (
                <Line
                  icon={Stethoscope}
                  label="Vet"
                  value={[p.vet_name, p.vet_phone].filter(Boolean).join(" · ")}
                />
              )}
              {p.emergency_contact && (
                <Line icon={Phone} label="Emergency" value={p.emergency_contact} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default JobPetCareSheet;
