import { useEffect, useState } from "react";
import { Heart, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
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
  const [saved, setSaved] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("favorite_helpers")
        .select("id")
        .eq("customer_id", customerId)
        .eq("helper_id", helperId)
        .maybeSingle();
      if (!cancelled) setSaved(!!data);
    })();
    return () => {
      cancelled = true;
    };
  }, [helperId, customerId]);

  const toggle = async () => {
    if (working || saved === null) return;
    setWorking(true);
    hapticLight();
    if (saved) {
      const { error } = await supabase
        .from("favorite_helpers")
        .delete()
        .eq("customer_id", customerId)
        .eq("helper_id", helperId);
      if (error) {
        toast.error("Couldn't unsave helpr");
      } else {
        setSaved(false);
        onChange?.(false);
        toast.success("Removed from your saved helprs");
      }
    } else {
      const { error } = await supabase
        .from("favorite_helpers")
        .insert({ customer_id: customerId, helper_id: helperId });
      if (error) {
        toast.error("Couldn't save helpr");
      } else {
        setSaved(true);
        onChange?.(true);
        toast.success("Saved! Find them under Saved Helprs.");
      }
    }
    setWorking(false);
  };

  if (saved === null) {
    return (
      <Button
        variant="ghost"
        size={variant === "icon" ? "icon" : "sm"}
        disabled
        className={`rounded-xl ${className}`}
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
        className={`rounded-xl ${className}`}
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
      className={`rounded-xl h-9 w-9 shrink-0 ${className}`}
      aria-label={saved ? "Unsave helpr" : "Save helpr"}
      title={saved ? "Saved — tap to remove" : "Save this helpr"}
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
