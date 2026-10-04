/**
 * The ONLY framer-motion exports the bottom dock uses, behind the dynamic
 * `import("./dockMotion")` in useDockMotion.ts. A re-export module for the
 * reason framerRows.ts gives: one named chunk boundary that holds every
 * framer reference of the dock, so MobileNav itself has none.
 */
export { SharedLayoutPill } from "@/components/ui/SharedLayoutPill";
export { NavQuickMenu } from "./NavQuickMenu";
