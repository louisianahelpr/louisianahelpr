import { Navigate } from "react-router-dom";
import { SELL_MOVE_PATH } from "@/lib/declutter/sellChooser";

/**
 * /declutter/move: old links and notices. The moving sale is Sell a bunch with a move-out date now (lead 2026-10-30, one
 * flow), and that page has the gates.
 */
export default function DeclutterMovePage() {
  return <Navigate to={SELL_MOVE_PATH} replace />;
}
