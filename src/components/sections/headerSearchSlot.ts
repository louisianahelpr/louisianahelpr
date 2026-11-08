import { createContext, useContext } from "react";

/**
 * The phone top bar's search slot (owner 11-08, the Vinted header). A section whose Browse search lives deep in its
 * list (Shops, Homes: SectionSearchRow, with its filter sheet or popover anchored to its own button) turns it on with
 * SectionScreen's `searchSlot`; the row then draws itself in the bar (a portal) instead of above the list, so its
 * state, submit and filters stay where they are. Null everywhere else: the row draws in place.
 */
export const HeaderSearchSlot = createContext<HTMLElement | null>(null);

export const useHeaderSearchSlot = () => useContext(HeaderSearchSlot);
