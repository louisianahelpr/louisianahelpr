import { DeclutterGate } from "@/components/declutter/declutterUi";
import { DeclutterMoveSkeleton } from "@/components/declutter/DeclutterSkeletons";
import { SellerSetupGate } from "@/components/declutter/SellerSetup";
import MoveFlow, { MovingOutGate } from "@/components/declutter/DeclutterMoveView";

/**
 * /declutter/move: the 404 unless both hidden switches are on, 'declutter'
 * (DeclutterGate) and 'declutter_moving_out' (MovingOutGate).
 */
export default function DeclutterMovePage() {
  return (
    <DeclutterGate skeleton={<DeclutterMoveSkeleton />}>
      <MovingOutGate skeleton={<DeclutterMoveSkeleton />}>
        <SellerSetupGate>
          <MoveFlow />
        </SellerSetupGate>
      </MovingOutGate>
    </DeclutterGate>
  );
}
