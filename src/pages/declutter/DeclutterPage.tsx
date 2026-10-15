import { DeclutterGate } from "@/components/declutter/declutterUi";
import { DeclutterHomeSkeleton } from "@/components/declutter/DeclutterSkeletons";
import DeclutterHome from "@/components/declutter/DeclutterHomeView";

/** /declutter: the 404 unless the hidden 'declutter' switch is on (DeclutterGate). */
export default function DeclutterPage() {
  return (
    <DeclutterGate skeleton={<DeclutterHomeSkeleton />}>
      <DeclutterHome />
    </DeclutterGate>
  );
}
