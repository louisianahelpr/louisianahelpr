import { useQueryClient } from "@tanstack/react-query";
import AppPage from "@/components/AppPage";
import ShopView from "@/components/shops/ShopView";
import PublicShopView from "@/components/shops/PublicShopView";
import { useFeature } from "@/hooks/useFeature";
import { useAuthReady } from "@/hooks/useAuthReady";

/**
 * /shops/:id is open to anyone with the link (SH2b, owner 2026-10-19). A
 * member with the 'shops' switch gets the full page (follow, order, owner
 * tools); everyone else, signed out included, gets the public page
 * (shops_public_shop), which asks them to sign in to order or message.
 */
export default function ShopPage() {
  const enabled = useFeature("shops");
  const { user, isReady } = useAuthReady();
  const qc = useQueryClient();
  if (enabled) return <ShopView />;
  const state = qc.getQueryState(["feature-enabled", "shops", user?.id ?? null]);
  const settled = isReady && (!user || state?.status === "success" || state?.status === "error");
  if (settled) return <PublicShopView />;
  return (
    <AppPage title="Shop" backTo="/">
      <p className="sr-only" role="status">Loading</p>
    </AppPage>
  );
}
