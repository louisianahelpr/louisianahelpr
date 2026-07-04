import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Heart, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { successToast } from "@/lib/toast";
import { hapticLight } from "@/lib/haptics";

interface SaveHelperButtonProps {
  helperId: string;
  customerId: string;
  variant?: "icon" | "full";
  className?: string;
  onChange?: (saved: boolean) => void;
}

/**
 * Heart toggle for posters to save / unsave a helper.
 * Surfaces the previously-unused `favorite_helpers` table so posters
 * can later send Direct Offers from the Saved Helpers page.
 */
export const SaveHelperButton = ({
  helperId,
  customerId,
  variant = "icon",
  className = "",
  onChange,
}: SaveHelperButtonProps) => {
  const navigate = useNavigate();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("favorite_helpers")
        .select("id")
        .eq("customer_id", customerId)
        .eq("helper_id", helperId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error("[SaveHelperButton] failed to load saved status:", error);
        // Resolve to a usable (unsaved) state so the button doesn't
        // hang on its loading spinner forever.
        setSaved(false);
        return;
      }
      setSaved(!!data);
    })();
    return () => {
      cancelled = true;
    };
  }, [helperId, customerId]);

  const toggle = async () => {
    if (working || saved === null) return;

    // Optimistic update: flip state immediately so the UI responds on tap.
    const previousSaved = saved;
    const nextSaved = !saved;
    setSaved(nextSaved);
    onChange?.(nextSaved);
    setWorking(true);
    hapticLight();

    const { error } = previousSaved
      ? await supabase
          .from("favorite_helpers")
          .delete()
          .eq("customer_id", customerId)
          .eq("helper_id", helperId)
      : await supabase
          .from("favorite_helpers")
          .insert({ customer_id: customerId, helper_id: helperId });

    if (error) {
      // Revert on failure so the persisted state stays consistent.
      setSaved(previousSaved);
      onChange?.(previousSaved);
      toast.error(previousSaved ? "Couldn't unsave Helpr — try again?" : "Couldn't save Helpr — try again?");
    } else if (nextSaved) {
      successToast("Saved to your Helprs", {
        action: { label: "View", onClick: () => navigate("/saved-helpers") },
      });
    } else {
      toast.success("Removed from your saved Helprs");
    }

    setWorking(false);
  };

  if (saved === null) {
    return (
      <Button
        variant="ghost"
        size={variant === "icon" ? "icon" : "sm"}
        disabled
        className={`rounded-ds-md ${className}`}
        aria-label="Loading saved status"
      >
        <Loader2 className="w-4 h-4 animate-spin" />
      </Button>
    );
  }

  if (variant === "full") {
    return (
      <Button
        type="button"
        variant={saved ? "secondary" : "outline"}
        size="sm"
        onClick={toggle}
        disabled={working}
        className={`rounded-ds-md ${className}`}
      >
        {working ? (
          <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
        ) : (
          <Heart
            className={`w-4 h-4 mr-1.5 ${saved ? "fill-destructive text-destructive" : ""}`}
          />
        )}
        {saved ? "Saved" : "Save Helpr"}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      disabled={working}
      className={`rounded-ds-md h-10 w-10 shrink-0 ${className}`}
      aria-label={saved ? "Unsave Helpr" : "Save Helpr"}
      title={saved ? "Saved — tap to remove" : "Save this Helpr"}
    >
      {working ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Heart
          className={`w-4 h-4 ${saved ? "fill-destructive text-destructive" : "text-muted-foreground"}`}
        />
      )}
    </Button>
  );
};

export default SaveHelperButton;
