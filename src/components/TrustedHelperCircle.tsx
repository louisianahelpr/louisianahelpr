import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Users, Plus, Trash2, Star, MapPin, CalendarHeart, Search, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

type Circle = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

type CircleMember = {
  id: string;
  helper_id: string;
  category: string | null;
  nickname: string | null;
  helperName?: string;
  helperAvatar?: string | null;
  helperSkills?: string | null;
  helperLocation?: string | null;
  helperRating?: number;
  helperReviewCount?: number;
};

export function TrustedHelperCircle({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const [circles, setCircles] = useState<Circle[]>([]);
  const [selectedCircle, setSelectedCircle] = useState<Circle | null>(null);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [showAddHelper, setShowAddHelper] = useState(false);
  const [helperSearch, setHelperSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);

  useEffect(() => {
    loadCircles();
  }, [userId]);

  const loadCircles = async () => {
    const { data } = await supabase
      .from("helper_circles" as any)
      .select("*")
      .eq("owner_id", userId)
      .order("created_at");
    if (data) setCircles(data as any[]);
  };

  const createCircle = async () => {
    if (!newName.trim()) return;
    const { error } = await (supabase.from("helper_circles" as any) as any).insert({
      owner_id: userId,
      name: newName.trim(),
      description: newDesc.trim() || null,
    });
    if (error) {
      toast.error("Failed to create circle");
    } else {
      toast.success("Circle created!");
      setNewName("");
      setNewDesc("");
      setShowCreate(false);
      loadCircles();
    }
  };

  const deleteCircle = async (id: string) => {
    await (supabase.from("helper_circles" as any) as any).delete().eq("id", id);
    setCircles((prev) => prev.filter((c) => c.id !== id));
    if (selectedCircle?.id === id) {
      setSelectedCircle(null);
      setMembers([]);
    }
    toast.success("Circle deleted");
  };

  const loadMembers = async (circle: Circle) => {
    setSelectedCircle(circle);
    const { data } = await supabase
      .from("helper_circle_members" as any)
      .select("*")
      .eq("circle_id", circle.id);
    if (data && (data as any[]).length > 0) {
      const helperIds = (data as any[]).map((m: any) => m.helper_id);
      const [profilesRes, reviewsRes] = await Promise.all([
        supabase.from("profiles").select("user_id, full_name, avatar_url, skills, location").in("user_id", helperIds),
        supabase.from("reviews").select("reviewee_id, rating").in("reviewee_id", helperIds),
      ]);
      const nameMap = new Map(profilesRes.data?.map((p) => [p.user_id, p]) || []);
      const ratingMap = new Map<string, number[]>();
      reviewsRes.data?.forEach((r) => {
        if (!ratingMap.has(r.reviewee_id)) ratingMap.set(r.reviewee_id, []);
        ratingMap.get(r.reviewee_id)!.push(r.rating);
      });
      setMembers(
        (data as any[]).map((m: any) => {
          const profile = nameMap.get(m.helper_id);
          const ratings = ratingMap.get(m.helper_id) || [];
          return {
            ...m,
            helperName: profile?.full_name || "Helpr",
            helperAvatar: profile?.avatar_url,
            helperSkills: profile?.skills,
            helperLocation: profile?.location,
            helperRating: ratings.length > 0 ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : 0,
            helperReviewCount: ratings.length,
          };
        })
      );
    } else {
      setMembers([]);
    }
  };

  const searchHelpers = async () => {
    if (!helperSearch.trim()) return;
    const { data } = await supabase
      .from("profiles")
      .select("user_id, full_name, avatar_url, skills, location")
      .eq("role", "helper")
      .eq("approval_status", "approved")
      .neq("user_id", userId)
      .ilike("full_name", `%${helperSearch}%`)
      .limit(10);
    setSearchResults(data || []);
  };

  const addMember = async (helperId: string, helperName: string) => {
    if (!selectedCircle) return;
    const { error } = await (supabase.from("helper_circle_members" as any) as any).insert({
      circle_id: selectedCircle.id,
      helper_id: helperId,
    });
    if (error) {
      if (error.code === "23505") toast.error("Already in this circle");
      else toast.error("Failed to add helper");
    } else {
      toast.success(`${helperName} added to ${selectedCircle.name}!`);
      setShowAddHelper(false);
      setHelperSearch("");
      setSearchResults([]);
      loadMembers(selectedCircle);
    }
  };

  const removeMember = async (memberId: string) => {
    await (supabase.from("helper_circle_members" as any) as any).delete().eq("id", memberId);
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
    toast.success("Removed from circle");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-display font-semibold text-foreground flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" /> My Trusted Circles
        </h2>
        <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-1" /> New Circle
        </Button>
      </div>

      {circles.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center space-y-2">
          <Users className="w-10 h-10 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">
            Create a Trusted Helpr Circle to organize and instantly rebook your favorite helprs.
          </p>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-1" /> Create your first circle
          </Button>
        </div>
      )}

      {/* Circle cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {circles.map((circle) => (
          <div
            key={circle.id}
            className={`rounded-xl border bg-card p-4 cursor-pointer transition-all hover:shadow-md ${
              selectedCircle?.id === circle.id ? "border-primary ring-1 ring-primary/20" : "border-border"
            }`}
            onClick={() => loadMembers(circle)}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-foreground">{circle.name}</h3>
                {circle.description && <p className="text-xs text-muted-foreground mt-0.5">{circle.description}</p>}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); deleteCircle(circle.id); }}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Selected circle members */}
      {selectedCircle && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground">{selectedCircle.name}</h3>
            <Button size="sm" variant="outline" onClick={() => setShowAddHelper(true)}>
              <Plus className="w-4 h-4 mr-1" /> Add Helpr
            </Button>
          </div>

          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No helprs in this circle yet. Add your trusted helprs!
            </p>
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg border border-border group">
                  {m.helperAvatar ? (
                    <img src={m.helperAvatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">
                      {(m.helperName || "?")[0].toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{m.helperName}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {m.helperRating! > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Star className="w-3 h-3 fill-primary text-primary" />
                          {m.helperRating!.toFixed(1)} ({m.helperReviewCount})
                        </span>
                      )}
                      {m.helperLocation && (
                        <span className="flex items-center gap-0.5">
                          <MapPin className="w-3 h-3" /> {m.helperLocation}
                        </span>
                      )}
                      {m.category && (
                        <span className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground capitalize">
                          {m.category.replace("_", " ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="default"
                      className="text-xs"
                      onClick={() => navigate(`/post-job?rebook_helper=${m.helper_id}`)}
                    >
                      <CalendarHeart className="w-3.5 h-3.5 mr-1" /> Book
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs"
                      onClick={() => navigate(`/user/${m.helper_id}`)}
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                    <button
                      onClick={() => removeMember(m.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Circle Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Helpr Circle</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Circle name (e.g., Home Team, Event Crew)"
              maxLength={50}
            />
            <Input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              maxLength={200}
            />
            <Button onClick={createCircle} disabled={!newName.trim()} className="w-full">
              Create Circle
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Helper Dialog */}
      <Dialog open={showAddHelper} onOpenChange={setShowAddHelper}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Helper to {selectedCircle?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={helperSearch}
                onChange={(e) => setHelperSearch(e.target.value)}
                placeholder="Search by name…"
                onKeyDown={(e) => e.key === "Enter" && searchHelpers()}
              />
              <Button variant="outline" onClick={searchHelpers}>
                <Search className="w-4 h-4" />
              </Button>
            </div>
            {searchResults.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {searchResults.map((h) => (
                  <div key={h.user_id} className="flex items-center gap-3 p-2 rounded-lg border border-border">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{h.full_name}</p>
                      <p className="text-xs text-muted-foreground">{h.skills}</p>
                    </div>
                    <Button size="sm" onClick={() => addMember(h.user_id, h.full_name)}>
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
