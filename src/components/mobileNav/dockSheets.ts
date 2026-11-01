/**
 * The bottom dock's two sheets, behind the dynamic `import("./dockSheets")` in useDockSheets.ts (B85, 11-01).
 * One re-export module, one chunk boundary: the Radix dialog stack, the sheet primitive and its close icon live
 * behind it, so MobileNav's own chunk has none of them.
 */
export { CreateSheet } from "@/components/create/CreateSheet";
export { GateSheet } from "./GateSheet";
