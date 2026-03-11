import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Eye, Star, FileText } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type Tab = "pending" | "approved" | "denied" | "all";

const AdminUsers = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");

  // Profile detail view
  const [viewProfile, setViewProfile] = useState<Profile | null>(null);
  const [profileReviews, setProfileReviews] = useState<{ rating: number; feedback: string | null; reviewer_name: string }[]>([]);

  // Deny dialog
  const [denyProfile, setDenyProfile] = useState<Profile | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [denying, setDenying] = useState(false);

  const loadProfiles = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setProfiles(data);
    setLoading(false);
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const openProfile = async (profile: Profile) => {
    setViewProfile(profile);
    // Load reviews for this user
    const { data: reviews } = await supabase
      .from("reviews")
      .select("rating, feedback, reviewer_id")
      .eq("reviewee_id", profile.user_id);
    if (reviews && reviews.length > 0) {
      const reviewerIds = [...new Set(reviews.map((r) => r.reviewer_id))];
      const { data: reviewerProfiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", reviewerIds);
      const nameMap = new Map(reviewerProfiles?.map((p) => [p.user_id, p.full_name || "User"]) || []);
      setProfileReviews(
        reviews.map((r) => ({
          rating: r.rating,
          feedback: r.feedback,
          reviewer_name: nameMap.get(r.reviewer_id) || "User",
        }))
      );
    } else {
      setProfileReviews([]);
    }
  };

  const approveUser = async (profile: Profile) => {
    const { error } = await supabase
      .from("profiles")
      .update({ approval_status: "approved" })
      .eq("id", profile.id);
    if (error) toast.error(error.message);
    else {
      toast.success(`${profile.full_name || "User"} approved!`);
      // Notify user
      await supabase.from("notifications").insert({
        user_id: profile.user_id,
        title: "Account approved!",
        message: "Your account has been approved. You can now use the platform.",
        type: "success",
        link: "/dashboard",
      });
      loadProfiles();
      setViewProfile(null);
    }
  };

  const denyUser = async () => {
    if (!denyProfile) return;
    setDenying(true);
    const { error } = await supabase
      .from("profiles")
      .update({ approval_status: "denied" })
      .eq("id", denyProfile.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`${denyProfile.full_name || "User"} denied.`);
      await supabase.from("notifications").insert({
        user_id: denyProfile.user_id,
        title: "Account not approved",
        message: denyReason.trim()
          ? `Your account was not approved. Reason: ${denyReason.trim()}`
          : "Your account was not approved. Please contact support for details.",
        type: "warning",
        link: "/profile",
      });
      loadProfiles();
      setDenyProfile(null);
      setDenyReason("");
      setViewProfile(null);
    }
    setDenying(false);
  };

  const filtered = profiles.filter((p) => {
    if (tab === "pending") return p.approval_status === "pending";
    if (tab === "approved") return p.approval_status === "approved";
    if (tab === "denied") return p.approval_status === "denied";
    return true;
  });

  const pendingCount = profiles.filter((p) => p.approval_status === "pending").length;

  const statusBadge = (status: string) => {
    if (status === "approved") return <Badge className="bg-primary/10 text-primary text-xs">Approved</Badge>;
    if (status === "denied") return <Badge className="bg-destructive/10 text-destructive text-xs">Denied</Badge>;
    return <Badge className="bg-accent/20 text-accent-foreground text-xs">Pending</Badge>;
  };

  if (loading) return <p className="text-muted-foreground">Loading users…</p>;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "pending", label: "Pending", count: pendingCount },
    { key: "approved", label: "Approved" },
    { key: "denied", label: "Denied" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-display font-bold text-foreground">Users</h2>
        <span className="text-sm text-muted-foreground">{profiles.length} total</span>
      </div>

      <div className="flex gap-1 bg-secondary/50 rounded-lg p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1.5 text-xs bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No users in this category.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <div key={p.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="font-semibold text-foreground">{p.full_name || "—"}</p>
                    {statusBadge(p.approval_status)}
                    <Badge variant="secondary" className="capitalize text-xs">{p.role}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {p.location && <span>{p.location}</span>}
                    {p.phone && <span>{p.phone}</span>}
                    <span>Joined {new Date(p.created_at).toLocaleDateString()}</span>
                  </div>
                  {p.skills && <p className="text-xs text-muted-foreground mt-1">Skills: {p.skills}</p>}
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <Button size="sm" variant="outline" onClick={() => openProfile(p)}>
                    <Eye className="w-4 h-4 mr-1" /> View
                  </Button>
                  {p.approval_status === "pending" && (
                    <>
                      <Button size="sm" onClick={() => approveUser(p)}>
                        <CheckCircle2 className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive border-destructive/30 hover:bg-destructive/10"
                        onClick={() => { setDenyProfile(p); setDenyReason(""); }}
                      >
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Profile Detail Dialog */}
      <Dialog open={!!viewProfile} onOpenChange={() => setViewProfile(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{viewProfile?.full_name || "User Profile"}</DialogTitle>
          </DialogHeader>
          {viewProfile && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Role</p>
                  <p className="font-medium text-foreground capitalize">{viewProfile.role}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Status</p>
                  {statusBadge(viewProfile.approval_status)}
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Location</p>
                  <p className="font-medium text-foreground">{viewProfile.location || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Phone</p>
                  <p className="font-medium text-foreground">{viewProfile.phone || "—"}</p>
                </div>
                {viewProfile.hourly_rate && (
                  <div>
                    <p className="text-muted-foreground text-xs">Hourly Rate</p>
                    <p className="font-medium text-foreground">${viewProfile.hourly_rate}/hr</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-xs">Joined</p>
                  <p className="font-medium text-foreground">{new Date(viewProfile.created_at).toLocaleDateString()}</p>
                </div>
              </div>

              {viewProfile.bio && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Bio</p>
                  <p className="text-sm text-foreground">{viewProfile.bio}</p>
                </div>
              )}

              {viewProfile.skills && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Skills</p>
                  <p className="text-sm text-foreground">{viewProfile.skills}</p>
                </div>
              )}

              {viewProfile.id_document_url && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1 flex items-center gap-1"><FileText className="w-3 h-3" /> ID Document</p>
                  <a
                    href={viewProfile.id_document_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary underline"
                  >
                    View uploaded document
                  </a>
                </div>
              )}

              {/* Reviews */}
              <div>
                <p className="text-muted-foreground text-xs mb-2 flex items-center gap-1">
                  <Star className="w-3 h-3" /> Reviews ({profileReviews.length})
                </p>
                {profileReviews.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No reviews yet.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {profileReviews.map((r, i) => (
                      <div key={i} className="p-2 rounded-lg bg-secondary/30 border border-border">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star key={s} className={`w-3 h-3 ${s <= r.rating ? "fill-accent text-accent" : "text-muted-foreground/30"}`} />
                            ))}
                          </div>
                          <span className="text-xs text-muted-foreground">by {r.reviewer_name}</span>
                        </div>
                        {r.feedback && <p className="text-xs text-foreground">{r.feedback}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              {viewProfile.approval_status === "pending" && (
                <div className="flex gap-2 pt-2 border-t border-border">
                  <Button className="flex-1" onClick={() => approveUser(viewProfile)}>
                    <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                  </Button>
                  <Button
                    className="flex-1"
                    variant="outline"
                    className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => { setDenyProfile(viewProfile); setDenyReason(""); }}
                  >
                    <XCircle className="w-4 h-4 mr-1" /> Deny
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Deny Reason Dialog */}
      <Dialog open={!!denyProfile} onOpenChange={() => setDenyProfile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Deny {denyProfile?.full_name || "User"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Provide a reason for denying this application. The user will be notified.
            </p>
            <Textarea
              value={denyReason}
              onChange={(e) => setDenyReason(e.target.value)}
              placeholder="Reason for denial (optional)…"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDenyProfile(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={denyUser}
              disabled={denying}
            >
              {denying ? "Denying…" : "Deny User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminUsers;
