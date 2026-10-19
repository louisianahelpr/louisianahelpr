import AppPage from "@/components/AppPage";
import ShopView from "@/components/shops/ShopView";
import PublicShopView from "@/components/shops/PublicShopView";
import { useFeatureStatus } from "@/hooks/useFeature";

/**
 * /shops/:id is open to anyone with the link (SH2b, owner 2026-10-19). A
 * member with the 'shops' switch gets the full page (follow, order, owner
 * tools); everyone else, signed out included, gets the public page
 * (shops_public_shop), which asks them to sign in to order or message.
 * Nothing paints until the switch answer is in (settled is immediate when
 * signed out), so a member never sees the public page flash first.
 * The member view follows the LAST SUCCESSFUL answer: a background refetch
 * that errors does not swap a member's page for the public one mid-visit;
 * only a successful "off" does (lead re-review #3). Every read behind
 * ShopView is gated on the server, so a stale "on" shows nothing it shouldn't.
 */
export default function ShopPage() {
  const { settled, lastAnswer } = useFeatureStatus("shops");
  if (lastAnswer === true) return <ShopView />;
  if (settled) return <PublicShopView />;
  return (
    <AppPage title="Shop" backTo="/">
      <p className="sr-only" role="status">Loading</p>
    </AppPage>
  );
}
