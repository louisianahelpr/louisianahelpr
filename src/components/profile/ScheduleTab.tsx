import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MapPin, DollarSign, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import { HelperAvailability } from "@/components/HelperAvailability";
import { PreferredParishes } from "@/components/PreferredParishes";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

const ScheduleCard = ({ job, isPosted }: { job: Job; isPosted: boolean }) => (
  <div className={`rounded-xl border p-3 ${
    job.status === "open" ? "bg-primary/10 text-primary border-primary/20" :
    job.status === "in_progress" || job.status === "accepted" ? "bg-accent/20 text-accent-foreground border-accent/30" :
    "border-border bg-card"
  }`}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h4 className="font-semibold text-sm">{job.title}</h4>
          <span className="text-xs px-2 py-0.5 rounded-full bg-background/50 font-medium">{isPosted ? "Posted" : "Assigned"}</span>
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

interface ScheduleTabProps {
  postedJobs: Job[];
  assignedJobs: Job[];
  loading: boolean;
  userId: string;
  onBack: () => void;
}

export function ScheduleTab({ postedJobs, assignedJobs, loading, userId, onBack }: ScheduleTabProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const allJobs = [...postedJobs, ...assignedJobs];
  const jobsByDate = new Map<string, Job[]>();
  allJobs.forEach((j) => {
    const key = j.date_needed;
    if (!jobsByDate.has(key)) jobsByDate.set(key, []);
    jobsByDate.get(key)!.push(j);
  });

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split("T")[0];
  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  const getDateStr = (day: number) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const selectedJobs = selectedDate ? (jobsByDate.get(selectedDate) || []) : [];
  const upcomingJobs = allJobs.filter((j) => j.date_needed >= today).sort((a, b) => a.date_needed.localeCompare(b.date_needed)).slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">My Schedule</h1>
          <p className="text-muted-foreground text-sm">Your calendar, upcoming jobs & working hours</p>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-4">
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}><ChevronLeft className="w-4 h-4" /></Button>
              <h2 className="font-display font-semibold text-foreground text-sm">
                {currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </h2>
              <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}><ChevronRight className="w-4 h-4" /></Button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((day, i) => {
                if (day === null) return <div key={`e-${i}`} />;
                const dateStr = getDateStr(day);
                const hasJobs = jobsByDate.has(dateStr);
                const isToday = dateStr === today;
                const isSelected = dateStr === selectedDate;
                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                    className={`relative aspect-square flex flex-col items-center justify-center rounded-lg text-sm transition-colors ${
                      isSelected ? "bg-primary text-primary-foreground" :
                      isToday ? "bg-primary/10 text-primary font-bold" :
                      "hover:bg-secondary text-foreground"
                    }`}
                  >
                    {day}
                    {hasJobs && (
                      <span className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${isSelected ? "bg-primary-foreground" : "bg-primary"}`} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedDate && (
            <div className="space-y-3">
              <h3 className="font-display font-semibold text-foreground text-sm">
                {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </h3>
              {selectedJobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No jobs scheduled for this day.</p>
              ) : (
                selectedJobs.map((job) => (
                  <ScheduleCard key={job.id} job={job} isPosted={postedJobs.some((j) => j.id === job.id)} />
                ))
              )}
            </div>
          )}

          {!selectedDate && (
            <div className="space-y-3">
              <h3 className="font-display font-semibold text-foreground text-sm">Upcoming</h3>
              {upcomingJobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No upcoming jobs.</p>
              ) : (
                upcomingJobs.map((job) => (
                  <ScheduleCard key={job.id} job={job} isPosted={postedJobs.some((j) => j.id === job.id)} />
                ))
              )}
            </div>
          )}
        </>
      )}

      {/* Preferred parishes — instant alerts */}
      <div className="border-t border-border pt-6">
        <h2 className="text-lg font-display font-bold text-foreground mb-1">Home Parishes</h2>
        <p className="text-muted-foreground text-xs mb-4">Get instant alerts when jobs drop in your preferred territory</p>
        <PreferredParishes helperId={userId} />
      </div>

      {/* Availability section */}
      <div className="border-t border-border pt-6">
        <h2 className="text-lg font-display font-bold text-foreground mb-1">Working Hours</h2>
        <p className="text-muted-foreground text-xs mb-4">Set your weekly availability so customers know when you're free</p>
        <HelperAvailability userId={userId} />
      </div>
    </div>
  );
}
