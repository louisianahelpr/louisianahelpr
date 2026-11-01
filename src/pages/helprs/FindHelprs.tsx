import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Search, Send, Star } from "lucide-react";
import AppPage from "@/components/AppPage";
import UserAvatar from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { OfflineEmptyState } from "@/components/ui/OfflineEmptyState";
import { ChoicePill } from "@/components/ui/ChoicePill";
import { ID_VERIFIED_LABEL, ID_VERIFIED_PILL_STYLE, IdVerifiedShield } from "@/components/profile/IdVerifiedPill";
import { useFeedPhase } from "@/hooks/useFeedPhase";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAgeGate } from "@/hooks/useAgeGate";
import { JOB_CATEGORY_VALUES, skillChipLabel } from "@/lib/jobCategories";
import { directoryCardFacts, type DirectoryHelpr, type DirectoryStats } from "./findHelprsModel";

/**
 * /helprs — "Find a Helpr" (Q2437, owner-approved 2026-10-27).
 *
 * A poster browses Helprs by skill and town and offers a job to one through
 * the existing direct-offer flow (/post-job?offerTo=<id>), at THE POSTER'S
 * price (owner: "the whole point is for the poster to say their price, not for
 * a Helpr to set their rate"). So this page shows no rate of any kind.
 *
 * Who is listed is the server's decision (public.find_helprs: signed in only,
 * members who show skills, first name + last initial, never blocked, banned,
 * under-18 or test accounts). Ratings and jobs done come from the same
 * get_public_profile_stats the profile page reads, so the two never disagree.
 */
const SKILL_CHIPS = JOB_CATEGORY_VALUES.filter((v) => v !== "other").map((v) => skillChipLabel(v));

async function fetchDirectory(skill: string, town: string): Promise<{ helprs: DirectoryHelpr[]; stats: Map<string, DirectoryStats>; notReady?: boolean }> {
  const res = await supabase.rpc("find_helprs", { p_skill: skill || undefined, p_town: town || undefined, p_limit: 30 });
  // A build ahead of its migration (PGRST202 until db-deploy runs) says so, not "something went wrong".
  if (isMissingRpcNamed(res.error, "find_helprs")) return { helprs: [], stats: new Map(), notReady: true };
  const helprs = (unwrap(res) ?? []) as DirectoryHelpr[];
  const stats = new Map<string, DirectoryStats>();
  if (helprs.length > 0) {
    const rows = (unwrap(await supabase.rpc("get_public_profile_stats", { p_user_ids: helprs.map((h) => h.user_id) })) ?? []) as DirectoryStats[];
    for (const r of rows) stats.set(r.user_id, r);
  }
  return { helprs, stats };
}

export default function FindHelprs() {
  usePageTitle("Find a Helpr");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const skill = params.get("skill") ?? "";
  const town = params.get("town") ?? "";
  const [townDraft, setTownDraft] = useState(town);
  useEffect(() => setTownDraft(town), [town]);
  const { gate: ageGate, gatedProps: ageGatedProps } = useAgeGate();

  const q = useQuery({
    queryKey: ["find-helprs", skill, town],
    queryFn: () => fetchDirectory(skill, town),
    staleTime: 60_000,
  });
  // Q571: offline with nothing loaded is "You're offline", never "No Helprs match".
  const phase = useFeedPhase({ status: q.status, fetchStatus: q.fetchStatus });

  const setParam = (key: "skill" | "town", value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const submitTown = (e: FormEvent) => {
    e.preventDefault();
    setParam("town", townDraft.trim().slice(0, 60));
  };

  return (
    <AppPage title="Find a Helpr" onBack={() => navigate(-1)}>
      <div className="space-y-4 pb-6" data-testid="find-helprs">
        <p className="text-ds-14 text-muted-foreground">
          Find someone near you, then offer them your job at your price. If they pass, it opens to everyone.
        </p>

        <form onSubmit={submitTown} className="flex max-w-xl items-end gap-2" role="search" aria-label="Find a Helpr by town">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="helpr-town">Town or parish</Label>
            <Input id="helpr-town" value={townDraft} maxLength={60} onChange={(e) => setTownDraft(e.target.value)} placeholder="e.g. Lafayette" autoComplete="address-level2" />
          </div>
          <Button type="submit" variant="outline">
            <Search className="h-4 w-4" aria-hidden />
            Search
          </Button>
        </form>

        <div className="space-y-1.5">
          <p id="helpr-skill-label" className="text-ds-13 font-semibold text-foreground">Skill</p>
          <div role="radiogroup" aria-labelledby="helpr-skill-label" className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex-wrap lg:overflow-visible">
            {["", ...SKILL_CHIPS].map((label) => {
              const on = (label || "") === skill;
              return (
                <ChoicePill key={label || "any"} selected={on} onClick={() => setParam("skill", label)} className="shrink-0 whitespace-nowrap">
                  {label || "Any skill"}
                </ChoicePill>
              );
            })}
          </div>
        </div>

        {/* A plain line, not card bones: until the list arrives nobody knows how
            many cards it holds, so bones would promise a size and shape the list
            may not have (loadingStateShape). */}
        {q.isLoading && (
          <p role="status" className="text-ds-14 text-muted-foreground" data-testid="find-helprs-loading">Finding Helprs near you…</p>
        )}
        {/* A refusal the server words (signed out, restricted, unconfirmed email, too long) says so; anything else is the retry card. */}
        {q.isError && (rpcErrorMessage("find_helprs", q.error) ? (
          <p role="alert" className="text-ds-14 text-[hsl(var(--destructive-ink))]" data-testid="find-helprs-refused">
            {rpcErrorMessage("find_helprs", q.error)}
          </p>
        ) : (
          <ErrorState variant="inline" onRetry={() => { void q.refetch(); }} />
        ))}
        {q.data?.notReady && (
          <p className="text-ds-14 text-muted-foreground" data-testid="find-helprs-not-ready">
            Find a Helpr is still being switched on. Try again in a few minutes.
          </p>
        )}
        {phase === "offline-empty" && (
          <OfflineEmptyState body="Helprs near you show up here once you're back online." onRetry={() => { void q.refetch(); }} />
        )}
        {phase === "ready" && q.data && !q.data.notReady && q.data.helprs.length === 0 && (
          <EmptyState
            icon={Search}
            title="No Helprs match yet"
            body="Try another skill or a nearby town. You can also post the job to everyone."
            action={<Button asChild variant="outline"><Link to="/post-job">Post a job</Link></Button>}
          />
        )}
        {q.data && q.data.helprs.length > 0 && (
          <ul className="grid gap-3 lg:grid-cols-2" data-testid="find-helprs-list">
            {q.data.helprs.map((h) => {
              const f = directoryCardFacts(h, q.data.stats.get(h.user_id));
              return (
                <li key={h.user_id} className="rounded-2xl border border-border/60 bg-card p-4 shadow-[var(--card-shadow)]" data-testid="find-helprs-card">
                  <div className="flex items-start gap-3">
                    <Link to={`/user/${h.user_id}`} className="shrink-0" aria-label={`${f.name}'s profile`}>
                      <UserAvatar userId={h.user_id} src={h.avatar_url} name={f.name} pixelSize={48} aria-hidden className="h-12 w-12" />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <Link to={`/user/${h.user_id}`} className="inline-flex flex-wrap items-center gap-1.5 font-sans text-ds-16 font-bold text-foreground">
                        {f.name}
                        {h.is_id_verified && (
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-ds-11 font-semibold" style={ID_VERIFIED_PILL_STYLE}>
                            <IdVerifiedShield className="h-3 w-3" />{ID_VERIFIED_LABEL}
                          </span>
                        )}
                      </Link>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ds-13 text-muted-foreground">
                        {f.place && (
                          <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden />{f.place}</span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Star className="h-3.5 w-3.5" aria-hidden />
                          {f.rating}
                        </span>
                        <span>{f.jobsDone}</span>
                      </p>
                      {f.skills.length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Skills">
                          {f.skills.map((s) => (
                            <li key={s} className="rounded-full border border-border/70 px-2.5 py-0.5 text-ds-12 text-foreground">{s}</li>
                          ))}
                          {f.moreSkills > 0 && <li className="px-1 py-0.5 text-ds-12 text-muted-foreground">+{f.moreSkills} more</li>}
                        </ul>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button asChild variant="outline" size="sm" className="flex-1">
                      <Link to={`/user/${h.user_id}`}>View profile</Link>
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      className="flex-1"
                      onClick={ageGate("post", () => navigate(`/post-job?offerTo=${h.user_id}`))}
                      {...ageGatedProps("post")}
                    >
                      <Send className="h-3.5 w-3.5" aria-hidden />
                      Offer a job
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppPage>
  );
}
