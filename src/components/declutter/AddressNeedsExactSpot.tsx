/** Shown under an address when the lookup found the area but not the house (useExactAddressPoint). */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { declutterErrorMessage } from "@/lib/declutter/errors";

export function AddressNeedsExactSpot({ typedAddress, inexact, locating, shareMyLocation }: {
  typedAddress: string;
  inexact: { address: string } | null;
  locating: boolean;
  shareMyLocation: () => Promise<unknown>;
}) {
  // Said on the page: toast.success renders nothing (src/lib/toastPolicy.ts). Only for the address it was pressed on.
  const [usedFor, setUsedFor] = useState<string | null>(null);
  const typed = typedAddress.trim();
  if (usedFor === typed && !inexact) return <p role="status" className="text-ds-13 font-semibold text-foreground" data-address-spot-used="">Got it. We'll use where you are now.</p>;
  // Editing the address hides this: the next lookup is about the new text.
  if (!inexact || inexact.address !== typed) return null;
  return (
    <div className="space-y-2 rounded-2xl border border-border bg-muted/40 p-3 text-ds-13 text-foreground" role="status" data-address-needs-exact-spot="">
      <p className="font-semibold">We found your area, but not your house on the map.</p>
      <p>We need the exact spot, because pickups are checked there. If you're at this address now, use your location. It only marks the spot on our map, and people still see the address you typed.</p>
      <p>Not there right now? Check the address for a typo, or come back to this when you're home. No rush.</p>
      <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={locating} aria-label={locating ? undefined : "I'm at this address, use my location"}
        onClick={() => { shareMyLocation().then(() => setUsedFor(inexact.address), (err: unknown) => toast.error(declutterErrorMessage(err))); }}>
        {locating ? "Finding you…" : "I'm at this address"}
      </Button>
    </div>
  );
}
