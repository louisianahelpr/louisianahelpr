import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useEffect } from "react";

const categories = [
  { value: "cleaning", label: "Cleaning" },
  { value: "yard_work", label: "Yard Work" },
  { value: "moving", label: "Moving" },
  { value: "errands", label: "Errands" },
  { value: "handyman", label: "Handyman" },
  { value: "painting", label: "Painting" },
  { value: "delivery", label: "Delivery" },
  { value: "pet_care", label: "Pet Care" },
  { value: "assembly", label: "Assembly" },
  { value: "other", label: "Other" },
];

const PostJob = () => {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [location, setLocation] = useState("");
  const [dateNeeded, setDateNeeded] = useState("");
  const [startTime, setStartTime] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [budget, setBudget] = useState("");
  const [specialRequirements, setSpecialRequirements] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) navigate("/login");
    });
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("You must be logged in");
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("jobs").insert({
      customer_id: user.id,
      title: title.trim(),
      description: description.trim(),
      category: category as any,
      location: location.trim(),
      date_needed: dateNeeded,
      start_time: startTime || null,
      estimated_hours: estimatedHours ? parseFloat(estimatedHours) : null,
      budget: parseFloat(budget),
      special_requirements: specialRequirements.trim() || null,
    });

    setSaving(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Job posted!");
      navigate("/dashboard");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center h-16 px-4 gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-lg mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Post a task</h1>
            <p className="text-muted-foreground mt-1">Describe what you need help with</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="title">Task title</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Help me move a couch" required maxLength={100} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Provide details about the task…" required rows={4} maxLength={1000} />
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Address or area" required maxLength={200} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="date">Date needed</Label>
                <Input id="date" type="date" value={dateNeeded} onChange={(e) => setDateNeeded(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="time">Start time</Label>
                <Input id="time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="hours">Estimated hours</Label>
                <Input id="hours" type="number" step="0.5" min="0.5" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} placeholder="2" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="budget">Budget ($)</Label>
                <Input id="budget" type="number" step="1" min="5" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="50" required />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="requirements">Special requirements (optional)</Label>
              <Textarea id="requirements" value={specialRequirements} onChange={(e) => setSpecialRequirements(e.target.value)} placeholder="Any tools needed, access instructions, etc." rows={2} maxLength={500} />
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={saving}>
              {saving ? "Posting…" : "Post task"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default PostJob;
