import { lazy } from "react";

// Dialogs and overlays — none are visible on first paint. Each is code-split
// and only the dialogs the user actually opens get fetched, keeping the
// Dashboard route chunk small.
export const JobDetailDialog = lazy(() => import("@/components/dashboard/JobDetailDialog"));
export const ApplyBody = lazy(() => import("@/components/dashboard/applyConfirmDialog/ApplyBody").then(m => ({ default: m.ApplyBody })));
export const ApplyConfirmDialog = lazy(() => import("@/components/dashboard/ApplyConfirmDialog").then(m => ({ default: m.ApplyConfirmDialog })));
export const ReportDialog = lazy(() => import("@/components/ReportDialog"));
export const BirthdayPopup = lazy(() => import("@/components/BirthdayPopup"));
// Map column for the web-desktop two-pane (the map surface pulls Apple's
// MapKit JS from the CDN — lazy so the phone/native feed never pays for it).
export const BrowseMap = lazy(() => import("@/components/BrowseMap").then(m => ({ default: m.BrowseMap })));
