/**
 * A seller's address box (owner 10-30: "It should also be set up like jobs: when I enter the address it should open from
 * the populated list and use that"). The Post a Job autocomplete, with what a pick means for Declutter added: the whole
 * address is kept, the city becomes the area buyers see, and the exact point is taken only when Apple placed the house.
 * Any other pick goes through the same lookup as typing, so a town or street match reaches the note under the box and is
 * never saved as the point. While the list can't be used the same box takes a typed address.
 *
 * On a phone the box scrolls up when it takes focus, and again as the keyboard opens, so the list opens in the room left
 * above the keyboard and the bottom nav wherever the box sits on its page (tester T10, 10-30: Pickup places, list top 480
 * in a 476px window; at full height the nav covered the 4th suggestion).
 *
 * `onChange(address, city)`: the city is what buyers see. Empty when the address has none.
 */
import { useRef, useState } from "react";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { FieldError } from "@/components/ui/FieldError";
import { AddressAutocomplete } from "@/components/postjob/AddressAutocomplete";
import { areaFromAddress } from "./sellForm";
import type { useExactAddressPoint } from "./useExactAddressPoint";

/** "123 Main St, Baton Rouge, LA 70808". A pick that is only a town doesn't say the town twice. */
function wholeAddress(street: string, city: string, state: string, zip: string): string {
  const stateZip = [state, zip].filter(Boolean).join(" ");
  const sameAsCity = street.trim().toLowerCase() === city.trim().toLowerCase();
  return [sameAsCity ? "" : street, city, stateZip].map((s) => s.trim()).filter(Boolean).join(", ");
}

export function SellerAddressField({ id, ariaLabel, value, onChange, place, className, onBlurred }: {
  id: string;
  ariaLabel: string;
  value: string;
  onChange: (address: string, city: string) => void;
  place: Pick<ReturnType<typeof useExactAddressPoint>, "locate" | "takePicked">;
  className?: string;
  onBlurred?: () => void;
}) {
  // As Post a Job: Helpr works in Louisiana only, so a pick elsewhere is refused rather than kept.
  const [outOfState, setOutOfState] = useState(false);
  const desktop = useIsWebDesktop();
  const boxRef = useRef<HTMLDivElement>(null);
  const bringUp = () => {
    if (desktop) return;
    // Optional-called: jsdom has no scrollIntoView.
    boxRef.current?.scrollIntoView?.({ block: "start" });
    const viewport = window.visualViewport;
    if (!viewport) return;
    const again = () => {
      viewport.removeEventListener("resize", again);
      boxRef.current?.scrollIntoView?.({ block: "start" });
    };
    viewport.addEventListener("resize", again);
    window.setTimeout(() => viewport.removeEventListener("resize", again), 1000);
  };
  return (
    // scroll-mt: under the page's fixed title, with the field's own label still showing.
    <div ref={boxRef} className="scroll-mt-24" onFocusCapture={bringUp}>
      <AddressAutocomplete
        id={id}
        ariaLabel={ariaLabel}
        className={className}
        value={value}
        placeholder="Start typing, then pick your address"
        plainWithoutMapKit
        keepListInView
        onBlurred={onBlurred}
        onChange={(typed) => { setOutOfState(false); onChange(typed, areaFromAddress(typed)); }}
        onPick={({ street, city, state, zipCode, point }) => {
          const st = state.trim();
          if (st && !/^(la|louisiana)$/i.test(st)) {
            setOutOfState(true);
            onChange("", "");
            return;
          }
          const address = wholeAddress(street, city, st && "LA", zipCode);
          onChange(address, city.trim() || areaFromAddress(address));
          if (point) {
            place.takePicked({ ...point, address });
            return;
          }
          // Found early, for the note under the box. A failure is said again at Save, in its own words.
          place.locate(address).catch((e: unknown) => console.warn("[address] lookup after a pick:", e instanceof Error ? e.message : "unknown"));
        }}
      />
      {outOfState && <FieldError>Helpr works in Louisiana only. Pick a Louisiana address.</FieldError>}
    </div>
  );
}
