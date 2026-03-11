import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Eye } from "lucide-react";
import { createClient } from "@supabase/supabase-js";

type PendingProfile = {
  id: string;
  user_id: string;
  full_name: string | null;
  phone: string | null;
  location: string | null;
  bio: string | null;
  skills: string | null;
  avatar_url: string | null;
  id_document_url: string | null;
  approval_status: string;
  created_at: string;
};

const AdminReviews = () => {
  const [profiles, setProfiles] = useState<PendingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "approved" | "denied">("pending");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadProfiles = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("approval_status", filter)
      .order("created_at", { ascending: false });
    if (data) setProfiles(data as PendingProfile[]);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    loadProfiles();
  }, [filter]);

  const updateStatus = async (profileId: string, userId: string, status: "approved" | "denied") => {
    setActionLoading(profileId);
    const { error } = await supabase
      .from("profiles")
      .update({ approval_status: status })
      .eq("id", profileId);

    setActionLoading(null);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`Profile ${status}!`);
      loadProfiles();
    }
  };

  const getIdDocumentUrl = (profile: PendingProfile) => {
    if (!profile.id_document_url) return null;
    const { data } = supabase.storage.from("id-documents").getPublicUrl(profile.id_document_url);
    return data.publicUrl;
  };

  if (loading) return <p className="text-muted-foreground">Loading profiles…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-display font-bold text-foreground">Profile Reviews</h2>
        <span className="text-sm text-muted-foreground">{profiles.length} {filter}</span>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(["pending", "approved", "denied"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
              filter === f
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {profiles.length === 0 ? (
        <p className="text-muted-foreground text-sm py-8 text-center">No {filter} profiles.</p>
      ) : (
        <div className="space-y-4">
          {profiles.map((profile) => (
            <div key={profile.id} className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-start gap-4">
                {/* Avatar */}
                <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0">
                  {profile.avatar_url ? (
                    <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-lg font-bold text-muted-foreground">
                      {(profile.full_name || "?")[0].toUpperCase()}
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-foreground">{profile.full_name || "—"}</h3>
                    <Badge variant="secondary" className="text-xs capitalize">{profile.approval_status}</Badge>
                  </div>
                  {profile.location && <p className="text-sm text-muted-foreground">{profile.location}</p>}
                  {profile.phone && <p className="text-xs text-muted-foreground">{profile.phone}</p>}
                </div>

                {/* Actions */}
                {filter === "pending" && (
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      onClick={() => updateStatus(profile.id, profile.user_id, "approved")}
                      disabled={actionLoading === profile.id}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => updateStatus(profile.id, profile.user_id, "denied")}
                      disabled={actionLoading === profile.id}
                    >
                      <XCircle className="w-4 h-4 mr-1" /> Deny
                    </Button>
                  </div>
                )}
              </div>

              {/* Bio */}
              {profile.bio && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">About</p>
                  <p className="text-sm text-foreground">{profile.bio}</p>
                </div>
              )}

              {/* Skills */}
              {profile.skills && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Skills</p>
                  <p className="text-sm text-foreground">{profile.skills}</p>
                </div>
              )}

              {/* ID Document */}
              {profile.id_document_url && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">ID Document</p>
                  <a
                    href={getIdDocumentUrl(profile) || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <Eye className="w-4 h-4" /> View document
                  </a>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Signed up {new Date(profile.created_at).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminReviews;
