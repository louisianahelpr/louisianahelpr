import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { MapPin, Calendar, DollarSign, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

const PublicJobsPreview = () => {
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

  if (loading || jobs.length === 0) return null;

  return (
    <section className="py-20 px-4 bg-gradient-to-b from-background to-secondary/30">
      <div className="container mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <div className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium tracking-wide uppercase mb-4">
            Live right now
          </div>
          <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground">
            Tasks Waiting for Help
          </h2>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
            Real tasks posted by your Louisiana neighbors. Sign up to start helping or post your own.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {jobs.map((job, i) => (
            <motion.div
              key={job.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: i * 0.08 }}
              className="rounded-2xl border border-border bg-card p-5 space-y-3 hover:border-primary/30 hover:shadow-md transition-all"
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
            </motion.div>
          ))}
        </div>

        <div className="text-center mt-8">
          <Button
            variant="hero"
            size="lg"
            onClick={() => navigate("/signup")}
            className="group"
          >
            Sign up to help or post a task
            <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
          </Button>
        </div>
      </div>
    </section>
  );
};

export default PublicJobsPreview;
