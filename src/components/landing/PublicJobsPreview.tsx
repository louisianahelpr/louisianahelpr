import { useEffect, useState, forwardRef } from "react";
import { MapPin, Calendar, DollarSign, Sparkles, ArrowRight, Leaf, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { getCityState } from "@/lib/locationUtils";

interface PublicJob {
  id: string;
  title: string;
  category: string;
  location: string;
  budget: number;
  date_needed: string;
  is_urgent: boolean | null;
  is_boosted: boolean | null;
}

const categoryLabels: Record<string, string> = {
  cleaning: "Cleaning",
  yard_work: "Yard Work",
  moving: "Moving",
  errands: "Errands",
  handyman: "Handyman",
  painting: "Painting",
  delivery: "Delivery",
  pet_care: "Pet Care",
  assembly: "Assembly",
  other: "Other",
};

const PublicJobsPreview = forwardRef<HTMLElement>((_props, ref) => {
  const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const goToPostJob = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    navigate(session?.user ? "/post-job" : "/signup");
  };

  useEffect(() => {
    const fetchJobs = async () => {
      const { data } = await supabase
        .rpc("get_public_open_jobs", { p_limit: 50 });
      setJobs((data as unknown as PublicJob[]) || []);
      setLoading(false);
    };
    fetchJobs();
  }, []);

  return (
    <section id="open-jobs" ref={ref} className="pt-1 pb-5 md:pt-2 md:pb-7 px-4 sm:px-6 lg:px-8 scroll-mt-24">
      <div className="container mx-auto max-w-6xl">
        <div className="mb-4 sm:mb-5 max-w-3xl animate-fade-in">
          <span className="text-display-eyebrow mb-4">Live jobs</span>
          <h2 className="text-display-xl mt-4">Browse open jobs</h2>
          <p className="subhead-serif text-foreground text-xl sm:text-2xl mt-5 leading-snug max-w-xl">
            Real tasks posted by your Louisiana neighbors. Sign up to start helping
            or post your own.
          </p>
        </div>

        {loading ? (
          <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto scrollbar-hide overscroll-x-contain snap-x snap-mandatory">
            <div className="flex gap-5 w-max pb-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="snap-start shrink-0 w-80 h-44 card-floating animate-pulse"
                />
              ))}
            </div>
          </div>
        ) : jobs.length > 0 ? (
          <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto scrollbar-hide overscroll-x-contain snap-x snap-mandatory">
            <div className="flex gap-5 w-max pb-4">
              {jobs.map((job, i) => (
                <article
                  key={job.id}
                  style={{ animationDelay: `${i * 80}ms` }}
                  className={`snap-start shrink-0 w-80 card-floating p-6 flex flex-col gap-4 animate-fade-in opacity-0 ${
                    job.is_boosted ? "ring-1 ring-primary/30" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-display italic font-bold text-foreground line-clamp-2 text-base leading-snug tracking-tight">
                      {job.title}
                    </h3>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {job.is_boosted && (
                        <Badge className="text-[10px] rounded-full bg-primary/10 text-primary border-primary/20 hover:bg-primary/15 gap-1">
                          <Rocket className="w-2.5 h-2.5" /> Boosted
                        </Badge>
                      )}
                      {job.is_urgent && (
                        <Badge variant="destructive" className="text-[10px] rounded-full">
                          Urgent
                        </Badge>
                      )}
                    </div>
                  </div>

                  <Badge variant="secondary" className="self-start text-xs rounded-full px-3 py-1">
                    {categoryLabels[job.category] || job.category}
                  </Badge>

                  <div className="mt-auto pt-3 border-t border-border/60 space-y-2 text-xs text-foreground/80">
                    <a
                      href={`https://www.google.com/maps/search/${encodeURIComponent(getCityState(job.location))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 hover:text-primary transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MapPin className="w-3.5 h-3.5" strokeWidth={1.75} />
                      <span className="line-clamp-1">{getCityState(job.location)}</span>
                    </a>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" strokeWidth={1.75} />
                        {format(new Date(job.date_needed), "MMM d, yyyy")}
                      </span>
                      <span className="flex items-center gap-1 font-semibold text-foreground tabular-nums">
                        <DollarSign className="w-3.5 h-3.5" strokeWidth={1.75} />
                        {job.budget}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          // Empty state — sample job card LEADS the section, partially
          // overlapping the section above for depth and reduced empty space.
          // "Be the first to post" CTA sits below.
          <div className="text-center max-w-2xl mx-auto pb-10 sm:pb-14">
            {/* Sample job card — pulled up via negative margin so it
                overlaps the section above and removes the empty band. */}
            <article className="card-floating relative mx-auto -mt-16 sm:-mt-20 lg:-mt-24 max-w-md p-6 text-left">
              {/* Category badge — matches the dashboard avatar dot pattern */}
              <span
                aria-label="Yard Work"
                className="absolute -top-2 -left-2 w-7 h-7 rounded-full flex items-center justify-center bg-emerald-700/65 ring-2 ring-card shadow-sm"
              >
                <Leaf className="w-3.5 h-3.5 text-white/85" strokeWidth={2.25} />
              </span>
              <div className="flex items-center justify-between mb-4 pl-3">
                <span
                  className="text-display-eyebrow"
                  style={{ fontSize: "0.6rem" }}
                >
                  Example post
                </span>
                <span className="font-serif italic text-xs text-foreground/60">
                  3 hours ago
                </span>
              </div>
              <h4
                className="font-display italic font-bold text-lg sm:text-xl leading-tight"
                style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.018em" }}
              >
                Help with hurricane prep
              </h4>
              <p className="font-serif italic mt-1.5 text-sm sm:text-base leading-snug text-foreground/75">
                Need to clear branches and check shutters before the storm.
              </p>
              <div className="flex items-center gap-1.5 mt-3 text-xs font-serif italic text-foreground/65">
                <MapPin className="w-3.5 h-3.5" strokeWidth={1.5} />
                Magazine St., Uptown · 2.4 mi
              </div>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-[hsl(var(--olivewood))]/10">
                {/* Achievement-badge price tile — parchment gradient, gold hairline */}
                <span
                  className="flex items-baseline gap-0.5 px-3 py-1.5 rounded-xl font-display italic font-bold text-xl sm:text-2xl tabular-nums"
                  style={{
                    color: "hsl(var(--bark))",
                    letterSpacing: "-0.015em",
                    background: "linear-gradient(180deg, hsla(38, 50%, 96%, 0.85) 0%, hsla(38, 30%, 92%, 0.7) 100%)",
                    border: "0.5px solid hsl(var(--bark) / 0.22)",
                    boxShadow:
                      "inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.85), " +
                      "inset 0 -1px 2px 0 hsl(var(--bark) / 0.10), " +
                      "inset 0 0 0 0.5px hsl(var(--gold-warm) / 0.18), " +
                      "0 1px 2px hsl(var(--olivewood) / 0.06), " +
                      "0 6px 14px -4px hsl(var(--bark) / 0.22)",
                  }}
                >
                  <DollarSign className="w-4 h-4" strokeWidth={2.25} />
                  85
                </span>
                <span className="font-serif italic text-xs sm:text-sm text-foreground/65">
                  Posted by Marcus B.
                </span>
              </div>
            </article>

            {/* Headline + subhead now sit BELOW the sample card so the visitor
                sees the example first, then is invited to post. */}
            <div className="mt-10 sm:mt-12">
              <span className="text-display-eyebrow">Community waiting</span>
              <h3
                className="font-serif font-black italic mt-3 text-balance text-3xl sm:text-4xl lg:text-5xl tracking-[-0.04em] leading-[0.95]"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                Be the first to post.
              </h3>
              <p className="subhead-serif mt-4 sm:mt-5 text-lg sm:text-xl text-foreground leading-snug max-w-md mx-auto">
                No open tasks in your neighborhood yet. Yours will look like
                this once it&rsquo;s up.
              </p>
            </div>

            <Button
              size="xl"
              onClick={goToPostJob}
              className="btn-liquid-fill group mt-8 sm:mt-10 h-14 sm:h-16 px-8 rounded-2xl tracking-tight"
              style={{
                fontFamily: "\"Beth Ellen\", cursive",
                fontWeight: 400,
                fontSize: "1.25rem",
                lineHeight: 1,
                color: "hsl(var(--parchment))",
                backgroundColor: "hsl(var(--sage))",
                border: "1px solid hsl(var(--sage))",
                boxShadow:
                  "inset 0 1px 0 0 rgba(255,255,255,0.25), 0 1px 2px rgba(0,0,0,0.04), 0 8px 32px -8px rgba(0,0,0,0.06)",
              }}
            >
              <Sparkles className="mr-2 w-5 h-5" strokeWidth={1.25} />
              Post the first task
              <ArrowRight className="ml-2 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.25} />
            </Button>
          </div>
        )}
      </div>
    </section>
  );
});
PublicJobsPreview.displayName = "PublicJobsPreview";

export default PublicJobsPreview;
