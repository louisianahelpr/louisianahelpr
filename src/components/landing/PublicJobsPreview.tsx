import { useEffect, useState, forwardRef } from "react";
import { MapPin, Calendar, DollarSign, ArrowRight, Apple, Facebook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { getCityState } from "@/lib/locationUtils";

const APP_STORE_URL = "https://apps.apple.com/us/app/helpr/id6754470134";
const FACEBOOK_URL = "https://www.facebook.com/louisianahelpr";

interface PublicJob {
  id: string;
  title: string;
  category: string;
  location: string;
  budget: number;
  date_needed: string;
  is_urgent: boolean | null;
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

  useEffect(() => {
    const fetchJobs = async () => {
      const today = new Date().toISOString().split("T")[0];
      const { data } = await supabase
        .from("open_jobs_safe" as any)
        .select("id, title, category, location, budget, date_needed, is_urgent")
        .gte("date_needed", today)
        .order("created_at", { ascending: false })
        .limit(6) as { data: PublicJob[] | null };
      setJobs(data || []);
      setLoading(false);
    };
    fetchJobs();
  }, []);

  return (
    <section id="open-jobs" ref={ref} className="pt-4 pb-16 md:pt-6 md:pb-20 px-4 scroll-mt-24">
      <div className="container mx-auto max-w-5xl">
        <div className="text-center mb-8 animate-fade-in">
          <div className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium tracking-wide uppercase mb-4">
            Live jobs
          </div>
          <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground">
            Browse open jobs
          </h2>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
            Real tasks posted by your Louisiana neighbors. Sign up to start helping or post your own.
          </p>
        </div>

        {loading ? (
          <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto scrollbar-hide overscroll-x-contain snap-x snap-mandatory">
            <div className="flex gap-4 w-max pb-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="snap-start shrink-0 w-72 h-40 rounded-2xl border border-border bg-card p-5 animate-pulse"
                />
              ))}
            </div>
          </div>
        ) : jobs.length > 0 ? (
          <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto scrollbar-hide overscroll-x-contain snap-x snap-mandatory">
            <div className="flex gap-4 w-max pb-2">
              {jobs.map((job, i) => (
                <div
                  key={job.id}
                  style={{ animationDelay: `${i * 80}ms` }}
                  className="snap-start shrink-0 w-72 rounded-2xl border border-border bg-card p-5 space-y-3 hover:border-primary/30 hover:shadow-md transition-all animate-fade-in opacity-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-foreground line-clamp-1 text-sm">
                      {job.title}
                    </h3>
                    {job.is_urgent && (
                      <Badge variant="destructive" className="text-[10px] shrink-0">
                        Urgent
                      </Badge>
                    )}
                  </div>

                  <Badge variant="secondary" className="text-xs">
                    {categoryLabels[job.category] || job.category}
                  </Badge>

                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <a
                      href={`https://www.google.com/maps/search/${encodeURIComponent(getCityState(job.location))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 hover:text-primary transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MapPin className="w-3 h-3" />
                      <span className="line-clamp-1">{getCityState(job.location)}</span>
                    </a>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3 h-3" />
                      <span>{format(new Date(job.date_needed), "MMM d, yyyy")}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <DollarSign className="w-3 h-3" />
                      <span className="font-medium text-foreground">${job.budget}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <p className="text-muted-foreground">No open jobs are posted right now. Check back soon — new tasks are added daily.</p>
          </div>
        )}

        {/* App Store + Facebook actions */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex h-12 w-full sm:w-[190px] items-center justify-center gap-2.5 rounded-xl bg-foreground px-5 py-2.5 text-background shadow-[0_8px_24px_-8px_hsl(var(--foreground)/0.4)] ring-1 ring-foreground/10 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-10px_hsl(var(--foreground)/0.6)]"
            aria-label="Download Helpr on the App Store"
          >
            <Apple className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} fill="currentColor" />
            <span className="text-left leading-tight">
              <span className="block text-[9px] font-medium uppercase tracking-[0.18em] opacity-70">Download on the</span>
              <span className="block text-sm font-semibold tracking-tight">App Store</span>
            </span>
          </a>
          <a
            href={FACEBOOK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex h-12 w-full sm:w-[190px] items-center justify-center gap-2.5 rounded-xl bg-[#0d4a8f] px-5 py-2.5 text-white shadow-[0_8px_24px_-8px_rgba(13,74,143,0.4)] ring-1 ring-white/10 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-[#0a3a72] hover:shadow-[0_16px_36px_-10px_rgba(13,74,143,0.6)]"
            aria-label="Follow Helpr on Facebook"
          >
            <Facebook className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} fill="currentColor" />
            <span className="text-left leading-tight">
              <span className="block text-[9px] font-medium uppercase tracking-[0.18em] opacity-70">Follow us on</span>
              <span className="block text-sm font-semibold tracking-tight">Facebook</span>
            </span>
          </a>
        </div>

      </div>
    </section>
  );
});
PublicJobsPreview.displayName = "PublicJobsPreview";

export default PublicJobsPreview;
