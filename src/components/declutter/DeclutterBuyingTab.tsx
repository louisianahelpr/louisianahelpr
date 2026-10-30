/** Declutter's Buying tab, on its own chunk (see DeclutterHomeView.tsx). */
import type { DeclutterTodo } from "@/lib/declutter/tabs";
import { BoughtWhatNext } from "./BoughtWhatNext";
import { BuyingDash } from "./DeclutterMineViews";

export function BuyingTab({ todo }: { todo: DeclutterTodo | null }) {
  return <><BoughtWhatNext /><BuyingDash todo={todo} /></>;
}
