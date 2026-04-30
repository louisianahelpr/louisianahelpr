import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, MapPin, DollarSign, Clock } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

const statusColors: Record<string, string> = {
  open: "bg-primary/10 text-primary border-primary/20",
  accepted: "bg-accent/20 text-accent-foreground border-accent/30",
  in_progress: "bg-accent/20 text-accent-foreground border-accent/30",
  completed: "bg-secondary text-secondary-foreground border-border",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
};

const Schedule = () => {
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["schedule"],
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) { navigate("/login"); return { posted: [] as Job[], assigned: [] as Job[] }; }
      const [posted, assigned] = await Promise.all([
        supabase.from("jobs").select("*").eq("customer_id", user.id).in("status", ["open", "accepted", "in_progress"]).order("date_needed"),
        supabase.from("jobs").select("*").eq("helper_id", user.id).in("status", ["accepted", "in_progress"]).order("date_needed"),
      ]);
      return { posted: (posted.data || []) as Job[], assigned: (assigned.data || []) as Job[] };
    },
  });

  const postedJobs = data?.posted ?? [];
  const assignedJobs = data?.assigned ?? [];
  const loading = isLoading && !data;

  const postedIds = useMemo(() => new Set(postedJobs.map((j) => j.id)), [postedJobs]);

  const jobsByDate = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const j of postedJobs) {
      const arr = map.get(j.date_needed);
      if (arr) arr.push(j); else map.set(j.date_needed, [j]);
    }
    for (const j of assignedJobs) {
      const arr = map.get(j.date_needed);
      if (arr) arr.push(j); else map.set(j.date_needed, [j]);
    }
    return map;
  }, [postedJobs, assignedJobs]);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = useMemo(() => new Date().toISOString().split("T")[0], []);

  const prevMonth = useCallback(() => setCurrentMonth(new Date(year, month - 1, 1)), [year, month]);
  const nextMonth = useCallback(() => setCurrentMonth(new Date(year, month + 1, 1)), [year, month]);

  const days = useMemo(() => {
    const arr: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) arr.push(null);
    for (let i = 1; i <= daysInMonth; i++) arr.push(i);
    return arr;
  }, [firstDay, daysInMonth]);

  const getDateStr = (day: number) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const selectedJobs = selectedDate ? (jobsByDate.get(selectedDate) || []) : [];

  const upcomingJobs = useMemo(() => {
    const all = [...postedJobs, ...assignedJobs];
    return all
      .filter((j) => j.date_needed >= today)
      .sort((a, b) => a.date_needed.localeCompare(b.date_needed))
      .slice(0, 10);
  }, [postedJobs, assignedJobs, today]);

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader title="My Schedule" />

      <main className="container mx-auto px-5 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-muted-foreground">Your calendar and upcoming jobs.</p>
            <Button variant="outline" size="sm" onClick={() => navigate("/availability")} className="gap-2">
              <Clock className="w-4 h-4" /> Set availability
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-4">
              <Button variant="ghost" size="icon" onClick={prevMonth} disabled={loading}><ChevronLeft className="w-4 h-4" /></Button>
              <h2 className="font-display font-semibold text-foreground">
                {currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </h2>
              <Button variant="ghost" size="icon" onClick={nextMonth} disabled={loading}><ChevronRight className="w-4 h-4" /></Button>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-1">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((day, i) => {
                if (day === null) return <div key={`e-${i}`} className="aspect-square" />;
                const dateStr = getDateStr(day);
                const hasJobs = !loading && jobsByDate.has(dateStr);
                const isToday = dateStr === today;
                const isSelected = dateStr === selectedDate;

                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                    disabled={loading}
                    className={`relative aspect-square flex flex-col items-center justify-center rounded-lg text-sm transition-colors ${
                      isSelected ? "bg-primary text-primary-foreground" :
                      isToday ? "bg-primary/10 text-primary font-bold" :
                      "hover:bg-secondary text-foreground"
                    }`}
                  >
                    {day}
                    {hasJobs && !isSelected && (
                      <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-primary" />
                    )}
                    {hasJobs && isSelected && (
                      <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-primary-foreground" />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-4 mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-primary" /> Jobs scheduled
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-primary/30" /> Today
              </span>
            </div>
          </div>

          <div className="min-h-[280px]">
            {loading ? (
              <div className="space-y-3">
                <div className="h-5 w-32 rounded bg-muted/40 animate-pulse" />
                <div className="h-20 rounded-xl bg-muted/30 animate-pulse" />
                <div className="h-20 rounded-xl bg-muted/30 animate-pulse" />
              </div>
            ) : selectedDate ? (
              <div className="space-y-3">
                <h3 className="font-display font-semibold text-foreground">
                  {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                </h3>
                {selectedJobs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No jobs scheduled for this day.</p>
                ) : (
                  selectedJobs.map((job) => (
                    <JobScheduleCard key={job.id} job={job} isPosted={postedIds.has(job.id)} />
                  ))
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <h3 className="font-display font-semibold text-foreground">Upcoming</h3>
                {upcomingJobs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No upcoming jobs scheduled.</p>
                ) : (
                  upcomingJobs.map((job) => (
                    <JobScheduleCard key={job.id} job={job} isPosted={postedIds.has(job.id)} />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

const JobScheduleCard = ({ job, isPosted }: { job: Job; isPosted: boolean }) => (
  <div className={`rounded-xl border p-4 ${statusColors[job.status] || "border-border bg-card"}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h4 className="font-semibold text-sm">{job.title}</h4>
          <span className="text-xs px-2 py-0.5 rounded-full bg-background/50 font-medium">
            {isPosted ? "Posted" : "Assigned"}
          </span>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
          <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> ${job.budget}</span>
          {job.start_time && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {job.start_time}</span>}
        </div>
      </div>
      <span className="text-xs font-medium capitalize">{job.status.replace("_", " ")}</span>
    </div>
  </div>
);

export default Schedule;
