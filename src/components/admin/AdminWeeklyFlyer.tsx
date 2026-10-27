// Admin -> Weekly jobs flyer (Q2431). Picks this week's live open jobs, draws
// the owner's flyer (src/lib/admin/weeklyJobsFlyer.ts) as a 1080x1350 PNG in
// the browser, and hands back a Download button and a ready caption with Copy.
//
// LAYOUT: renders inside the admin shell (a document-scroll page), so no
// viewport lock and no rail inset here; AdminViewShell / AdminCard only.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AdminViewShell, AdminCard } from "@/components/admin/AdminViewShell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { readJobsAheadOfDb } from "@/lib/jobColumns";
import { unwrap } from "@/lib/supabaseResult";
import { copyToClipboard, shareFileNative } from "@/lib/nativeShare";
import helprLogo from "@/assets/helpr-logo-256.webp";
import {
  FLYER_MAX_JOBS,
  drawWeeklyJobsFlyer,
  flyerCaption,
  flyerJobLines,
  realJobsOnly,
  thisWeeksJobs,
  toFlyerJob,
  type FlyerJob,
  type FlyerSourceJob,
} from "@/lib/admin/weeklyJobsFlyer";

const FLYER_SELECT =
  "id, title, budget, date_needed, start_time, location, pricing_mode, urgent_fee, helpers_needed, is_group_job, helper_fee_flat_cents, helper_fee_percent";

/**
 * Live open jobs, real ones only. open_jobs_browse is what a member can apply
 * to right now (open, funded, not past, not ownerless); it does not expose
 * is_seed, so the ids are checked against jobs.is_seed and a job is kept only
 * when that read says false. A failed seed read fails the whole load: a flyer
 * that might print a test job is worse than no flyer.
 */
async function fetchFlyerJobs(): Promise<FlyerSourceJob[]> {
  const res = await readJobsAheadOfDb(FLYER_SELECT, (columns) =>
    supabase.from("open_jobs_browse").select(columns).order("date_needed", { ascending: true }).limit(200),
  { browseView: true });
  const rows = (unwrap(res) ?? []) as unknown as FlyerSourceJob[];
  if (rows.length === 0) return [];
  const seeds = unwrap(await supabase.from("jobs").select("id, is_seed").in("id", rows.map((r) => r.id))) ?? [];
  return realJobsOnly(rows, seeds);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error ?? new Error("read_failed"));
    r.readAsDataURL(blob);
  });
}

const AdminWeeklyFlyer = () => {
  const query = useQuery({ queryKey: ["admin", "weekly-flyer", "jobs"], queryFn: fetchFlyerJobs, staleTime: 60_000 });
  const weekJobs = useMemo(() => thisWeeksJobs(query.data ?? [], new Date()), [query.data]);

  const [picked, setPicked] = useState<string[] | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  // First load: the soonest jobs, up to what one flyer holds.
  useEffect(() => {
    if (picked === null && query.data) setPicked(weekJobs.slice(0, FLYER_MAX_JOBS).map((j) => j.id));
  }, [picked, query.data, weekJobs]);

  const flyerJobs: FlyerJob[] = useMemo(() => {
    const ids = new Set(picked ?? []);
    return weekJobs
      .filter((j) => ids.has(j.id))
      .map((j) => {
        const base = toFlyerJob(j);
        const edited = titles[j.id];
        return edited !== undefined ? { ...base, title: edited } : base;
      });
  }, [weekJobs, picked, titles]);

  const caption = useMemo(() => flyerCaption(flyerJobs), [flyerJobs]);

  const [png, setPng] = useState<{ blob: Blob; url: string } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [drawFailed, setDrawFailed] = useState(false);
  const urlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!query.data) return;
    let cancelled = false;
    setDrawing(true);
    const t = window.setTimeout(() => {
      drawWeeklyJobsFlyer(flyerJobs, helprLogo)
        .then((blob) => {
          if (cancelled) return;
          if (urlRef.current) URL.revokeObjectURL(urlRef.current);
          const url = URL.createObjectURL(blob);
          urlRef.current = url;
          setPng({ blob, url });
          setDrawFailed(false);
        })
        .catch((e: unknown) => {
          // Not silent: the preview card says the flyer could not be drawn.
          console.error("[AdminWeeklyFlyer] draw:", e);
          if (!cancelled) setDrawFailed(true);
        })
        .finally(() => {
          if (!cancelled) setDrawing(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [flyerJobs, query.data]);
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const toggle = (id: string, on: boolean) => {
    setPicked((prev) => {
      const cur = prev ?? [];
      if (!on) return cur.filter((x) => x !== id);
      if (cur.includes(id)) return cur;
      if (cur.length >= FLYER_MAX_JOBS) {
        toast.error(`One flyer holds ${FLYER_MAX_JOBS} jobs. Untick one first.`);
        return cur;
      }
      return [...cur, id];
    });
  };

  const download = async () => {
    if (!png) return;
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await shareFileNative({
      fileName: `open-jobs-this-week-${stamp}.png`,
      base64: await blobToBase64(png.blob),
      blob: png.blob,
      title: "Open jobs this week",
      dialogTitle: "Save the weekly jobs flyer",
      source: "adminWeeklyFlyer",
    });
  };

  const copyCaption = async () => {
    const ok = await copyToClipboard(caption);
    if (ok) toast.success("Caption copied.");
    else toast.error("Couldn't copy. Select the caption and copy it by hand.");
  };

  return (
    <AdminViewShell>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <AdminCard
          title="Jobs on this flyer"
          subtitle={`Live open jobs from today through the next 6 days. Test jobs are never shown. Up to ${FLYER_MAX_JOBS}.`}
          action={
            <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
              <RefreshCw className={`w-4 h-4 mr-1.5 ${query.isFetching ? "animate-spin" : ""}`} aria-hidden />
              Refresh
            </Button>
          }
        >
          {query.isLoading && (
            <p className="flex items-center gap-2 text-ds-14 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Loading open jobs…
            </p>
          )}
          {query.isError && (
            <p role="alert" className="text-ds-14 text-destructive" data-testid="flyer-load-failed">
              Couldn't load the open jobs. Press Refresh to try again.
            </p>
          )}
          {query.data && weekJobs.length === 0 && (
            <p className="text-ds-14 text-muted-foreground" data-testid="flyer-no-jobs">
              No live open jobs this week. The flyer below says new jobs are posted every day.
            </p>
          )}
          {weekJobs.length > 0 && (
            <ul className="space-y-3" data-testid="flyer-job-list">
              {weekJobs.map((j) => {
                const on = (picked ?? []).includes(j.id);
                const fj = toFlyerJob(j);
                const [, when, price] = flyerJobLines(fj);
                return (
                  <li key={j.id} className="rounded-xl border border-border/60 p-3">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id={`flyer-${j.id}`}
                        checked={on}
                        onCheckedChange={(v) => toggle(j.id, v === true)}
                        className="mt-1"
                        aria-label={`Put ${j.title ?? "this job"} on the flyer`}
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <label htmlFor={`flyer-${j.id}`} className="block text-ds-14 font-semibold text-foreground break-words">
                          {j.title}
                        </label>
                        <p className="text-ds-13 text-muted-foreground">
                          {when || "Flexible date"} · <span className="tabular-nums">{price}</span> take-home
                        </p>
                        {on && (
                          <Input
                            aria-label="Title as it prints on the flyer"
                            value={titles[j.id] ?? fj.title}
                            maxLength={40}
                            onChange={(e) => setTitles((t) => ({ ...t, [j.id]: e.target.value.toUpperCase() }))}
                          />
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </AdminCard>

        <AdminCard
          title="Flyer"
          subtitle="1080 x 1350 PNG, sized for Instagram and Facebook."
          action={
            <Button onClick={() => void download()} disabled={!png || drawing} className="btn-grad-primary">
              <Download className="w-4 h-4 mr-1.5" aria-hidden />
              Download
            </Button>
          }
        >
          <div className="mx-auto w-full max-w-[420px]">
            {drawFailed ? (
              <p role="alert" className="text-ds-14 text-destructive" data-testid="flyer-draw-failed">
                The flyer could not be drawn in this browser. Try again in Chrome or Safari.
              </p>
            ) : png ? (
              <img
                src={png.url}
                alt="Weekly jobs flyer preview"
                data-testid="flyer-preview"
                className={`w-full h-auto rounded-xl border border-border/60 ${drawing ? "animate-pulse" : ""}`}
              />
            ) : (
              <div className="aspect-[4/5] w-full rounded-xl bg-muted animate-pulse" aria-hidden />
            )}
          </div>
        </AdminCard>
      </div>

      <AdminCard
        title="Caption"
        subtitle="Paste this under the flyer when you post it."
        action={
          <Button variant="outline" onClick={() => void copyCaption()} data-testid="flyer-copy-caption">
            <Copy className="w-4 h-4 mr-1.5" aria-hidden />
            Copy
          </Button>
        }
      >
        <Textarea readOnly value={caption} rows={Math.min(14, caption.split("\n").length + 1)} aria-label="Post caption" className="font-mono text-ds-13" />
      </AdminCard>
    </AdminViewShell>
  );
};

export default AdminWeeklyFlyer;
