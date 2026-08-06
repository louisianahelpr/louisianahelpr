import { AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import { formatTimestamp, formatCategory, formatShortDate } from "@/lib/format";
import type { Profile } from "../adminUserHelpers";

interface OverviewTabProps {
  viewProfile: Profile;
  profileViolations: any[];
}

export function OverviewTab({ viewProfile, profileViolations }: OverviewTabProps) {
  const p = viewProfile;
  const signupFields = [
    { label: "Experience Level", value: p.experience_level },
    { label: "Availability", value: p.availability },
    { label: "Transportation", value: p.transportation },
    { label: "Tools / Equipment", value: p.tools_equipment },
    { label: "Preferred Job Radius", value: p.job_radius },
    { label: "How They Heard About Us", value: p.hear_about_us },
    { label: "Emergency Contact", value: p.emergency_contact_name ? `${p.emergency_contact_name}${p.emergency_contact_phone ? ` — ${p.emergency_contact_phone}` : ""}` : null },
    { label: "Extra Comments", value: p.extra_comments },
  ];

  return (
    <TabsContent value="overview" className="space-y-6 mt-4 flex-1 min-h-0 overflow-y-auto pr-1">
      {/* Bio */}
      <div className="space-y-2">
        <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide">Bio</h4>
        <p className={`text-ds-13 leading-relaxed ${viewProfile.bio ? "text-foreground" : "text-muted-foreground italic"}`}>
          {viewProfile.bio || "Not provided"}
        </p>
      </div>

      {/* Contact & Account */}
      <div className="space-y-2">
        <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide">Contact & Account</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 rounded-ds-md bg-secondary/30 border border-border p-4">
          <div>
            <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Phone</p>
            <p className={`text-ds-13 font-medium ${viewProfile.phone ? "text-foreground" : "text-muted-foreground italic"}`}>{viewProfile.phone || "Not provided"}</p>
          </div>
          <div>
            <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Location</p>
            <p className={`text-ds-13 font-medium ${viewProfile.location ? "text-foreground" : "text-muted-foreground italic"}`}>{viewProfile.location || "Not provided"}</p>
          </div>
          <div>
            <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Date of Birth</p>
            <p className={`text-ds-13 font-medium ${viewProfile.date_of_birth ? "text-foreground" : "text-muted-foreground italic"}`}>
              {viewProfile.date_of_birth
                ? new Date(viewProfile.date_of_birth).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                : "Not provided"}
            </p>
          </div>
          <div>
            <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Joined</p>
            <p className="text-ds-13 font-medium text-foreground">{formatTimestamp(viewProfile.created_at)}</p>
          </div>
          <div>
            <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Last Active</p>
            <p className="text-ds-13 font-medium text-foreground">{formatDistanceToNow(new Date(viewProfile.updated_at), { addSuffix: true })}</p>
          </div>
        </div>
      </div>

      {/* Skills */}
      <div className="space-y-2">
        <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide">Skills</h4>
        {viewProfile.skills ? (
          <div className="flex flex-wrap gap-1.5">
            {viewProfile.skills.split(",").map((skill, i) => (
              <Badge key={i} variant="sienna" className="text-ds-11">{skill.trim()}</Badge>
            ))}
          </div>
        ) : (
          <p className="text-ds-11 text-muted-foreground italic">Not provided</p>
        )}
      </div>

      {/* Signup Answers */}
      <div className="space-y-2">
        <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide">Signup Answers</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 rounded-ds-md bg-secondary/30 border border-border p-4">
          {signupFields.map((f, i) => (
            <div key={i}>
              <p className="text-ds-10 uppercase tracking-wider text-muted-foreground font-medium mb-0.5">{f.label}</p>
              <p className={`text-ds-13 font-medium ${f.value ? "text-foreground" : "text-muted-foreground italic"}`}>{f.value || "Not provided"}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Violations History */}
      {profileViolations.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-destructive" /> Violations ({profileViolations.length})
          </h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {profileViolations.map((v: any) => (
              <div key={v.id} className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-ds-11 px-2 py-0.5 rounded-full font-medium ${
                    v.action_taken === "permanent_ban" ? "bg-destructive/10 text-destructive" :
                    v.action_taken === "temp_ban" ? "bg-destructive/10 text-destructive" :
                    "bg-accent/20 text-accent"
                  }`}>
                    {v.action_taken === "permanent_ban" ? "Perm Ban" : v.action_taken === "temp_ban" ? "Temp Ban" : "Warning"}
                  </span>
                  <span className="text-ds-11 text-muted-foreground">{formatCategory(v.violation_type ?? "")}</span>
                  <span className="text-ds-11 text-muted-foreground ml-auto">{formatShortDate(v.created_at)}</span>
                </div>
                {v.description && <p className="text-ds-11 text-foreground">{v.description}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </TabsContent>
  );
}
