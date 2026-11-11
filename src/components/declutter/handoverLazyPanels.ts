/**
 * The order panels that load on their own (Q178, 2026-10-17: each rides with its own orders, never the Buying tab's
 * critical path). Moved out of DeclutterHandoverViews so that file stays under the size ratchet; AddHelprPanel stays
 * there (the declutterAddAHelpr guard reads it in place).
 */
import { lazy } from "react";

export const OrderDeliveryPanel = lazy(() => import("./DeclutterDeliveryViews").then((m) => ({ default: m.OrderDeliveryPanel })));
export const ShipOrderPanel = lazy(() => import("./ShipOrderPanel").then((m) => ({ default: m.ShipOrderPanel }))); // B134: label (seller) and tracking (buyer), ship orders only (Q178).
export const ReturnLabelPanel = lazy(() => import("./ReturnLabelPanel").then((m) => ({ default: m.ReturnLabelPanel }))); // 20261103212046: the buyer's return label, ship orders only.
export const SellerDeliveryOrderPanel = lazy(() => import("./SellerDeliveryOrder").then((m) => ({ default: m.SellerDeliveryOrderPanel })));
export const DeclutterRefundPanel = lazy(() => import("./DeclutterRefundRequest").then((m) => ({ default: m.DeclutterRefundPanel }))); // Board 141: handed-over orders only.
export const DeclutterProblemSides = lazy(() => import("./DeclutterProblemSides").then((m) => ({ default: m.DeclutterProblemSides }))); // D2-3: both sides of a problem.
export const DeclutterProblemDecided = lazy(() => import("./DeclutterProblemSides").then((m) => ({ default: m.DeclutterProblemDecided })));
