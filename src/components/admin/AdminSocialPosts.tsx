// Admin → Social Posts. The owner-facing console for the Facebook/Instagram
// auto-poster.
//
// Ordering is the design: the kill switch is FIRST, above the queue, because
// it is the control you reach for when something is going wrong live and a
// screen that makes you scroll to find the stop button has failed at the one
// moment it mattered.
//
// LAYOUT: this renders INSIDE the admin shell, which is a document-scroll page
// already listed in `DOCUMENT_SCROLL_ROUTES`. So there is no viewport lock here
// and — deliberately — no desktop rail inset of any kind: `#root` is already
// padded by the global `html.web-desktop.desktop-rail:not(.app-shell) #root`
// rule, and re-insetting would push the column right by a second rail width.
// `AdminViewShell` / `AdminCard` supply all the structure this screen needs.

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminViewShell } from "@/components/admin/AdminViewShell";
import { MarketingSettingsCard } from "./marketing/MarketingSettingsCard";
import { MarketingQueue } from "./marketing/MarketingQueue";
import { MarketingComposerDialog } from "./marketing/MarketingComposerDialog";
import { fetchMarketingQueue, fetchMarketingSettings } from "./marketing/marketingApi";
import type { MarketingContentRow } from "./marketing/marketingTypes";

const SETTINGS_KEY = ["admin", "marketing", "settings"];
const QUEUE_KEY = ["admin", "marketing", "queue"];

const AdminSocialPosts = () => {
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<MarketingContentRow | null>(null);

  // No `initialData` / fallback on either query, on purpose. A fallback would
  // give these components a plausible-looking object to render during a
  // failure — and for the settings query that means painting "auto-publish is
  // off" on no evidence, which is the one lie this screen must never tell.
  // Both cards branch on `isError` explicitly instead.
  const settingsQuery = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: fetchMarketingSettings,
    // The kill switch is a live-safety control: a stale "off" is worth less
    // than a fresh read, so this refetches far more eagerly than the admin
    // default.
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const queueQuery = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: fetchMarketingQueue,
    staleTime: 30_000,
  });

  const refetchAll = useCallback(() => {
    void settingsQuery.refetch();
    void queueQuery.refetch();
  }, [settingsQuery, queueQuery]);

  const openCompose = useCallback(() => {
    setEditing(null);
    setComposerOpen(true);
  }, []);

  const openEdit = useCallback((row: MarketingContentRow) => {
    setEditing(row);
    setComposerOpen(true);
  }, []);

  return (
    <AdminViewShell>
      <MarketingSettingsCard
        settings={settingsQuery.data}
        isLoading={settingsQuery.isPending}
        isError={settingsQuery.isError}
        error={settingsQuery.error}
        onRetry={() => void settingsQuery.refetch()}
        onChanged={() => void settingsQuery.refetch()}
      />

      <MarketingQueue
        rows={queueQuery.data}
        isLoading={queueQuery.isPending}
        isError={queueQuery.isError}
        onRetry={() => void queueQuery.refetch()}
        onEdit={openEdit}
        onCompose={openCompose}
        onChanged={refetchAll}
      />

      <MarketingComposerDialog
        open={composerOpen}
        onOpenChange={setComposerOpen}
        row={editing}
        onSaved={refetchAll}
      />
    </AdminViewShell>
  );
};

export default AdminSocialPosts;
