import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { Camera, Star, Share2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

interface CompletionStory {
  jobId: string;
  title: string;
  category: string;
  beforeUrls: string[];
  afterUrls: string[];
  helperName: string;
  helperId: string;
  rating: number | null;
  feedback: string | null;
  completedAt: string;
}

const categoryLabels: Record<string, string> = {
  cleaning: "Cleaning", yard_work: "Yard Work", moving: "Moving", errands: "Errands",
  handyman: "Handyman", painting: "Painting", delivery: "Delivery", pet_care: "Pet Care",
  assembly: "Assembly", other: "Other",
};

const JobStoriesSection = () => {
  const navigate = useNavigate();
  const [stories, setStories] = useState<CompletionStory[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      // Get completed jobs with before/after photos
      const { data: jobs } = await supabase
        .from("jobs")
        .select("id, title, category, proof_before_urls, proof_after_urls, helper_id, poster_completed_at")
        .eq("status", "completed")
        .not("proof_after_urls", "is", null)
        .order("poster_completed_at", { ascending: false })
        .limit(10);

      if (!jobs || jobs.length === 0) { setLoaded(true); return; }

      // Filter to jobs that actually have photos
      const withPhotos = jobs.filter(j => 
        j.proof_after_urls && j.proof_after_urls.length > 0
      );

      if (withPhotos.length === 0) { setLoaded(true); return; }

      const helperIds = [...new Set(withPhotos.map(j => j.helper_id).filter(Boolean))] as string[];
      const jobIds = withPhotos.map(j => j.id);

      const [profilesRes, reviewsRes] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: helperIds }),
        supabase.from("reviews").select("job_id, rating, feedback").in("job_id", jobIds),
      ]);

      const nameMap = new Map(profilesRes.data?.map(p => [p.user_id, p.full_name || "Helpr"]) || []);
      const reviewMap = new Map(reviewsRes.data?.map(r => [r.job_id, r]) || []);

      setStories(withPhotos.slice(0, 3).map(j => {
        const review = reviewMap.get(j.id);
        return {
          jobId: j.id,
          title: j.title,
          category: j.category,
          beforeUrls: j.proof_before_urls || [],
          afterUrls: j.proof_after_urls || [],
          helperName: nameMap.get(j.helper_id || "") || "Helpr",
          helperId: j.helper_id || "",
          rating: review?.rating || null,
          feedback: review?.feedback || null,
          completedAt: j.poster_completed_at || "",
        };
      }));
      setLoaded(true);
    };
    load();
  }, []);

  const shareStory = (story: CompletionStory) => {
    const text = `Check out this ${categoryLabels[story.category] || story.category} job completed on Helpr! "${story.title}"`;
    const url = window.location.origin;
    if (navigator.share) {
      navigator.share({ title: "Helpr Success Story", text, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(`${text} — ${url}`);
    }
  };

  if (!loaded || stories.length === 0) return null;

  return (
    <section className="py-24 px-4">
      <div className="container mx-auto text-center">
        <div className="flex items-center justify-center gap-2 mb-4">
          <Camera className="w-6 h-6 text-primary" />
          <h2 className="text-3xl sm:text-4xl font-display font-bold text-foreground">
            Success Stories
          </h2>
        </div>
        <p className="text-muted-foreground max-w-md mx-auto mb-12">
          Real results from real Louisiana neighbors
        </p>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {stories.map((story, i) => (
            <div
              key={story.jobId}
              className="rounded-2xl border border-border bg-card overflow-hidden hover:shadow-lg transition-shadow animate-fade-in opacity-0"
              style={{ animationDelay: `${i * 150}ms` }}
            >
              {/* Before/After Photos */}
              <div className="grid grid-cols-2 h-40">
                <div className="relative overflow-hidden">
                  {story.beforeUrls.length > 0 ? (
                    <img src={story.beforeUrls[0]} alt="Before" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-secondary/50 flex items-center justify-center">
                      <span className="text-xs text-muted-foreground">No before photo</span>
                    </div>
                  )}
                  <span className="absolute bottom-1 left-1 text-[10px] font-bold bg-background/80 px-1.5 py-0.5 rounded">BEFORE</span>
                </div>
                <div className="relative overflow-hidden">
                  <img src={story.afterUrls[0]} alt="After" className="w-full h-full object-cover" />
                  <span className="absolute bottom-1 left-1 text-[10px] font-bold bg-primary/90 text-primary-foreground px-1.5 py-0.5 rounded">AFTER</span>
                </div>
              </div>

              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-foreground text-sm text-left">{story.title}</h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground shrink-0">
                    {categoryLabels[story.category] || story.category}
                  </span>
                </div>

                {story.rating && (
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map(s => (
                      <Star key={s} className={`w-3 h-3 ${s <= story.rating! ? "fill-primary text-primary" : "text-muted-foreground/30"}`} />
                    ))}
                  </div>
                )}

                {story.feedback && (
                  <p className="text-xs text-muted-foreground text-left line-clamp-2 italic">"{story.feedback}"</p>
                )}

                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => navigate(`/user/${story.helperId}`)}
                    className="text-xs text-primary hover:underline font-medium"
                  >
                    By {story.helperName}
                  </button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => shareStory(story)}>
                    <Share2 className="w-3 h-3 mr-1" /> Share
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default JobStoriesSection;
