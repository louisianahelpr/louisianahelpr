import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { MapPin, Calendar, DollarSign, ArrowRight, Search, Briefcase, Lock, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { format, formatDistanceToNow, differenceInHours } from "date-fns";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { usePageTitle } from "@/hooks/usePageTitle";
import { getCityState } from "@/lib/locationUtils";

interface PublicJob {
  id: string;
  title: string;
  category: string;
  location: string;
  budget: number;
  date_needed: string;
  is_urgent: boolean | null;
  created_at: string;
  expires_at: string | null;
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

const ALL_CATEGORIES = Object.keys(categoryLabels);

const Jobs = () => {
  usePageTitle("Browse Jobs — Helpr");
  const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchJobs = async () => {
      const { data } = await supabase
        .from("jobs")
        .select("id, title, category, location, budget, date_needed, is_urgent, created_at, expires_at")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(50);
      setJobs(data || []);
      setLoading(false);
    };
    fetchJobs();
  }, []);

  const filtered = jobs.filter((job) => {
    const matchesSearch =
      !search ||
      job.title.toLowerCase().includes(search.toLowerCase()) ||
      job.location.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !selectedCategory || job.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="pt-24 pb-20 px-4">
        <div className="container mx-auto max-w-5xl">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="text-center mb-10"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium tracking-wide uppercase mb-4">
              <Briefcase className="w-3 h-3" />
              Live Jobs
            </div>
            <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground">
              Browse Open Jobs
            </h1>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
              See what your Louisiana neighbors need help with. Sign up to apply or post your own task.
            </p>
          </motion.div>

          {/* Search & Filters */}
          <div className="mb-8 space-y-4">
            <div className="relative max-w-md mx-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search jobs by title or location…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>

            <div className="flex flex-wrap justify-center gap-2">
              <Badge
                variant={selectedCategory === null ? "default" : "outline"}
                className="cursor-pointer text-xs"
                onClick={() => setSelectedCategory(null)}
              >
                All
              </Badge>
              {ALL_CATEGORIES.map((cat) => (
                <Badge
                  key={cat}
                  variant={selectedCategory === cat ? "default" : "outline"}
                  className="cursor-pointer text-xs"
                  onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                >
                  {categoryLabels[cat]}
                </Badge>
              ))}
            </div>
          </div>

          {/* Jobs Grid */}
          {loading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-border bg-card p-5 h-40 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <Briefcase className="w-12 h-12 text-muted-foreground/30 mx-auto" />
              <p className="text-muted-foreground">No open jobs match your filters right now.</p>
              <p className="text-sm text-muted-foreground">Check back soon — new tasks are posted daily!</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((job, i) => (
                <motion.div
                  key={job.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.04 }}
                  className="rounded-2xl border border-border bg-card p-5 space-y-3 hover:border-primary/30 hover:shadow-md transition-all group relative"
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
                    <div className={`flex items-center gap-1.5 ${job.expires_at && differenceInHours(new Date(job.expires_at), new Date()) < 24 ? "text-destructive font-medium" : ""}`}>
                      <Timer className="w-3 h-3" />
                      <span>
                        {job.expires_at
                          ? new Date(job.expires_at) <= new Date()
                            ? "Expired"
                            : formatDistanceToNow(new Date(job.expires_at), { addSuffix: false }) + " left"
                          : "Posted " + formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>

                  {/* Locked overlay on hover */}
                  <div className="absolute inset-0 rounded-2xl bg-background/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                    <Lock className="w-5 h-5 text-primary" />
                    <p className="text-xs font-medium text-foreground">Sign up to apply</p>
                    <Button
                      size="sm"
                      variant="default"
                      className="text-xs"
                      onClick={() => navigate("/signup")}
                    >
                      Get Started
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {/* CTA */}
          <div className="text-center mt-12 space-y-4">
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-8 max-w-lg mx-auto space-y-4">
              <Lock className="w-8 h-8 text-primary mx-auto" />
              <h3 className="text-lg font-bold text-foreground">Ready to get started?</h3>
              <p className="text-sm text-muted-foreground">
                Sign up to apply for jobs, message posters, and start earning — or post your own task and find help today.
              </p>
              <Button
                variant="hero"
                size="lg"
                onClick={() => navigate("/signup")}
                className="group"
              >
                Sign up now
                <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Jobs;
