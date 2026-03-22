import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Eye, FileText, MapPin, Phone, Clock, Briefcase, Star, User } from "lucide-react";

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
  role: string;
  hourly_rate: number | null;
  portfolio_urls: string[] | null;
};

const AdminReviews = () => {
  const [profiles, setProfiles] = useState<PendingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "approved" | "denied">("pending");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Detail dialog
  const [selectedProfile, setSelectedProfile] = useState<PendingProfile | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [showDenyDialog, setShowDenyDialog] = useState(false);

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

  const updateStatus = async (profileId: string, userId: string, status: "approved" | "denied", reason?: string) => {
    setActionLoading(profileId);
    const { error } = await supabase
      .from("profiles")
      .update({ approval_status: status })
      .eq("id", profileId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`Profile ${status}!`);
      // Notify the user
      await supabase.from("notifications").insert({
        user_id: userId,
        title: status === "approved" ? "Account approved! 🎉" : "Account not approved",
        message: status === "approved"
          ? "Your account has been approved. You can now use the platform."
          : reason
            ? `Your account was not approved. Reason: ${reason}`
            : "Your account was not approved. Please contact support for details.",
        type: status === "approved" ? "success" : "warning",
        link: status === "approved" ? "/dashboard" : "/profile",
      });
      loadProfiles();
      setSelectedProfile(null);
      setShowDenyDialog(false);
      setDenyReason("");
    }
    setActionLoading(null);
  };

  const getIdDocumentUrl = (profile: PendingProfile) => {
    if (!profile.id_document_url) return null;
    // Check if it's already a full URL
    if (profile.id_document_url.startsWith("http")) return profile.id_document_url;
    const { data } = supabase.storage.from("id-documents").getPublicUrl(profile.id_document_url);
    return data.publicUrl;
  };

  const portfolioUrls = selectedProfile?.portfolio_urls || [];

  if (loading) return <p className="text-muted-foreground">Loading profiles…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
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
            <div
              key={profile.id}
              className="rounded-xl border border-border bg-card p-5 space-y-4 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all"
              onClick={() => setSelectedProfile(profile)}
            >
              <div className="flex items-start gap-4">
                {/* Avatar */}
                <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0">
                  {profile.avatar_url ? (
                    <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-lg font-bold text-muted-foreground">
                      {formatName(profile.full_name, "?")[0].toUpperCase()}
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-semibold text-foreground">{formatName(profile.full_name, "—")}</h3>
                    <Badge variant="secondary" className="text-xs capitalize">{profile.approval_status}</Badge>
                    <Badge variant="outline" className="text-xs capitalize">{profile.role}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {profile.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{profile.location}</span>}
                    {profile.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{profile.phone}</span>}
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Signed up {new Date(profile.created_at).toLocaleDateString()}</span>
                  </div>
                  {profile.skills && <p className="text-xs text-muted-foreground mt-1">Skills: {profile.skills}</p>}
                </div>

                {/* Quick actions */}
                {filter === "pending" && (
                  <div className="flex gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      onClick={() => updateStatus(profile.id, profile.user_id, "approved")}
                      disabled={actionLoading === profile.id}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => { setSelectedProfile(profile); setShowDenyDialog(true); }}
                      disabled={actionLoading === profile.id}
                    >
                      <XCircle className="w-4 h-4" />
                    </Button>
                  </div>
                )}

                {/* Click indicator */}
                <span className="text-xs text-muted-foreground self-center">View →</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Profile Detail Dialog */}
      <Dialog open={!!selectedProfile && !showDenyDialog} onOpenChange={() => setSelectedProfile(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              {selectedProfile?.full_name || "User Profile"}
            </DialogTitle>
          </DialogHeader>
          {selectedProfile && (
            <div className="space-y-5">
              {/* Profile header */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0">
                  {selectedProfile.avatar_url ? (
                    <img src={selectedProfile.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xl font-bold text-muted-foreground">
                      {(selectedProfile.full_name || "?")[0].toUpperCase()}
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{selectedProfile.full_name || "—"}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="secondary" className="text-xs capitalize">{selectedProfile.role}</Badge>
                    <Badge
                      className={`text-xs ${
                        selectedProfile.approval_status === "approved" ? "bg-primary/10 text-primary" :
                        selectedProfile.approval_status === "denied" ? "bg-destructive/10 text-destructive" :
                        "bg-accent/20 text-accent-foreground"
                      }`}
                    >
                      {selectedProfile.approval_status}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Location</p>
                  <p className="font-medium text-foreground flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-primary" />
                    {selectedProfile.location || "Not set"}
                  </p>
                </div>
                <div className="rounded-lg bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Phone</p>
                  <p className="font-medium text-foreground flex items-center gap-1">
                    <Phone className="w-3 h-3 text-primary" />
                    {selectedProfile.phone || "Not set"}
                  </p>
                </div>
                {selectedProfile.hourly_rate && (
                  <div className="rounded-lg bg-secondary/30 p-3">
                    <p className="text-xs text-muted-foreground mb-0.5">Hourly Rate</p>
                    <p className="font-medium text-foreground">${selectedProfile.hourly_rate}/hr</p>
                  </div>
                )}
                <div className="rounded-lg bg-secondary/30 p-3">
                  <p className="text-xs text-muted-foreground mb-0.5">Joined</p>
                  <p className="font-medium text-foreground">
                    {new Date(selectedProfile.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
              </div>

              {/* Bio */}
              {selectedProfile.bio && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">About</p>
                  <p className="text-sm text-foreground">{selectedProfile.bio}</p>
                </div>
              )}

              {/* Skills */}
              {selectedProfile.skills && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                    <Briefcase className="w-3 h-3" /> Skills
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedProfile.skills.split(",").map((skill, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                        {skill.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* ID Document */}
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                  <FileText className="w-3 h-3" /> ID Document
                </p>
                {selectedProfile.id_document_url ? (
                  <div className="space-y-2">
                    <a
                      href={getIdDocumentUrl(selectedProfile) || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
                    >
                      <Eye className="w-4 h-4" /> View uploaded document
                    </a>
                    {/* Try to show image preview if it looks like an image */}
                    {getIdDocumentUrl(selectedProfile) && /\.(jpg|jpeg|png|gif|webp)/i.test(getIdDocumentUrl(selectedProfile)!) && (
                      <img
                        src={getIdDocumentUrl(selectedProfile)!}
                        alt="ID Document"
                        className="max-w-full max-h-48 rounded-lg border border-border object-contain"
                      />
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No ID document uploaded</p>
                )}
              </div>

              {/* Portfolio */}
              {portfolioUrls.length > 0 && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                    <Star className="w-3 h-3" /> Portfolio ({portfolioUrls.length} items)
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {portfolioUrls.map((url, i) => {
                      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
                      return isImage ? (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                          className="aspect-square rounded-lg overflow-hidden border border-border hover:border-primary transition-colors block">
                          <img src={url} alt="" className="w-full h-full object-cover" />
                        </a>
                      ) : (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                          className="aspect-square rounded-lg border border-border flex flex-col items-center justify-center bg-secondary/30 hover:border-primary transition-colors">
                          <FileText className="w-5 h-5 text-muted-foreground" />
                          <p className="text-[9px] text-muted-foreground text-center mt-1 px-1 truncate w-full">
                            {url.split("/").pop()}
                          </p>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              {selectedProfile.approval_status === "pending" && (
                <div className="flex gap-2 pt-2 border-t border-border">
                  <Button
                    className="flex-1"
                    onClick={() => updateStatus(selectedProfile.id, selectedProfile.user_id, "approved")}
                    disabled={actionLoading === selectedProfile.id}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                    {actionLoading === selectedProfile.id ? "Approving…" : "Approve"}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => setShowDenyDialog(true)}
                    disabled={actionLoading === selectedProfile.id}
                  >
                    <XCircle className="w-4 h-4 mr-1" /> Deny
                  </Button>
                </div>
              )}

              {selectedProfile.approval_status === "denied" && (
                <div className="flex gap-2 pt-2 border-t border-border">
                  <Button
                    className="flex-1"
                    onClick={() => updateStatus(selectedProfile.id, selectedProfile.user_id, "approved")}
                    disabled={actionLoading === selectedProfile.id}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-1" /> Re-approve
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Deny Dialog */}
      <Dialog open={showDenyDialog} onOpenChange={(open) => { if (!open) { setShowDenyDialog(false); setDenyReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Deny {selectedProfile?.full_name || "User"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Provide a reason for denying this profile. The user will be notified.</p>
            <Textarea
              value={denyReason}
              onChange={(e) => setDenyReason(e.target.value)}
              placeholder="Reason for denial (optional)…"
              rows={3}
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => { setShowDenyDialog(false); setDenyReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => selectedProfile && updateStatus(selectedProfile.id, selectedProfile.user_id, "denied", denyReason.trim())}
              disabled={actionLoading === selectedProfile?.id}
            >
              {actionLoading === selectedProfile?.id ? "Denying…" : "Deny Profile"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminReviews;
