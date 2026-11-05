/**
 * Your own view of /u/<handle> (share-profile audit M3, 2026-11-05): it had no "This is what others see" line, no Edit
 * profile link and no prompt for what is still empty. This strip shows only on your own page: the line, Edit profile,
 * Copy link, and a next step for each empty part others would see (photo, a line about you, skills). Work photos have
 * their own "Add work photos" card on the page.
 */
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Camera, Link2, PenLine, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/nativeShare";
import { profileLinkUrl, type PublicProfile } from "@/lib/profileLink/api";

/** The profile editor (same paths as YouCard's EDIT_PROFILE_PATH and FirstJobHome's SKILLS_FOCUS_PATH). */
const OWNER_EDIT_PATH = "/profile?tab=profile";
const OWNER_SKILLS_PATH = "/profile?tab=profile&focus=skills";

interface OwnerStep { key: "photo" | "bio" | "skills"; label: string; to: string }

/** The next steps for what others would see as empty, in page order. */
function ownerSteps(p: Pick<PublicProfile, "photo_url" | "bio" | "skills">): OwnerStep[] {
  const steps: OwnerStep[] = [];
  if (!p.photo_url) steps.push({ key: "photo", label: "Add a profile photo", to: OWNER_EDIT_PATH });
  if (!(p.bio ?? "").trim()) steps.push({ key: "bio", label: "Write a line about you", to: OWNER_EDIT_PATH });
  if (!(p.skills ?? "").trim()) steps.push({ key: "skills", label: "Add your skills", to: OWNER_SKILLS_PATH });
  return steps;
}

const STEP_ICON = { photo: Camera, bio: PenLine, skills: Tags } as const;

export function PublicProfileOwnerSteps({ p }: { p: Pick<PublicProfile, "handle" | "photo_url" | "bio" | "skills"> }) {
  const steps = ownerSteps(p);
  const copy = async () => {
    if (await copyToClipboard(profileLinkUrl(p.handle))) toast("Link copied");
    else toast.error("Couldn't copy the link. Try Share instead.");
  };
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm" aria-label="Your page" data-testid="pp-owner">
      <p className="text-ds-14 text-muted-foreground">This is what others see when you share your link.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm" className="rounded-full">
          <Link to={OWNER_EDIT_PATH} data-testid="pp-owner-edit">Edit profile</Link>
        </Button>
        <Button type="button" variant="outline" size="sm" className="rounded-full" data-testid="pp-owner-copy" onClick={() => void copy()}>
          <Link2 className="mr-1.5 h-4 w-4" aria-hidden />Copy link
        </Button>
      </div>
      {steps.length > 0 && (
        <>
          <h2 className="mt-4 text-ds-14 font-semibold text-foreground">Finish your page</h2>
          <ul className="mt-2 flex flex-col gap-2" data-testid="pp-owner-steps">
            {steps.map((s) => {
              const Icon = STEP_ICON[s.key];
              return (
                <li key={s.key}>
                  <Link to={s.to} data-testid={`pp-owner-step-${s.key}`}
                    className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-ds-14 font-medium text-foreground">
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />{s.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
