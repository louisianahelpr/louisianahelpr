import { useNavigate } from "react-router-dom";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EDIT_PROFILE_PATH } from "@/components/profile/profileLanding/YouCard";

/**
 * Your own public profile's title-row Edit (app audit A3-C6, 2026-10-29): one tap to Edit profile.
 * The same 40px ghost shape as the "More options" button another member's profile shows there.
 */
export function OwnProfileEditButton() {
  const navigate = useNavigate();
  return (
    <Button
      variant="ghost"
      type="button"
      data-testid="own-profile-edit"
      aria-label="Edit profile"
      onClick={() => navigate(EDIT_PROFILE_PATH)}
      className="rounded-ds-md h-10 min-w-10 px-2 sm:px-3 shrink-0 gap-1.5 text-ds-14 font-bold"
      style={{ color: "hsl(var(--bark))" }}
    >
      <Pencil className="w-4 h-4" aria-hidden />
      {/* Icon only on a phone, so "How others see you" stays whole at 375. */}
      <span className="max-sm:hidden">Edit</span>
    </Button>
  );
}
