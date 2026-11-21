/**
 * The retired /holidays/lights and /holidays/events (2026-11-21: lights and events are one list on /holidays now).
 * Old links, pins and saved filters land on /holidays with the matching filter preset (holidayLegacyHref):
 * /holidays/lights?region=acadiana -> /holidays?what=lights&region=acadiana. vercel.json serves these two paths the app
 * shell only (a server redirect over an app route is refused by src/test/publicSiteFilesValid.test.ts), so the native
 * app and the web take the same path here. Guard: src/test/holidayHub.test.tsx.
 */
import { Navigate, useLocation } from "react-router-dom";
import { holidayLegacyHref } from "@/content/holidayHub/holidayHub.mjs";

export default function HolidayLegacyRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={holidayLegacyHref(pathname.replace(/\/+$/, ""), search)} replace />;
}
