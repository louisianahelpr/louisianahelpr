import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";

const Profile = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        navigate("/login");
        return;
      }
      setUser(session.user);
      populateFields(session.user);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        navigate("/login");
        return;
      }
      setUser(session.user);
      populateFields(session.user);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const populateFields = (u: User) => {
    const m = u.user_metadata;
    setFullName(m?.full_name || "");
    setPhone(m?.phone || "");
    setLocation(m?.location || "");
    setBio(m?.bio || "");
    setSkills(m?.skills || "");
    setHourlyRate(m?.hourly_rate || "");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.auth.updateUser({
      data: {
        full_name: fullName,
        phone,
        location,
        bio,
        skills,
        hourly_rate: hourlyRate,
      },
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Profile updated!");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const role = user?.user_metadata?.role || "customer";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center h-16 px-4 gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Link to="/" className="text-2xl font-display font-bold text-primary">
            Helpr
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-lg mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Edit profile</h1>
            <p className="text-muted-foreground mt-1">Keep your info up to date</p>
          </div>

          <form onSubmit={handleSave} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full name</Label>
              <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location (city or ZIP)</Label>
              <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="San Francisco, CA" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">About you</Label>
              <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell people about yourself…" rows={3} />
            </div>

            {role === "helper" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="skills">Skills & services</Label>
                  <Input id="skills" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Cleaning, yard work, moving…" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rate">Hourly rate ($)</Label>
                  <Input id="rate" type="number" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="25" />
                </div>
              </>
            )}

            <Button type="submit" className="w-full" size="lg" disabled={saving}>
              {saving ? "Saving…" : "Save profile"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default Profile;
