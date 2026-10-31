/**
 * BUY-9 (Declutter buying audit 10-30): checkout's "Deliver to" was typed from nothing on every order. The buyer's
 * own drop-offs are readable by the buyer only (declutter_delivery_dropoffs: column grant on address and geocoded_at
 * to authenticated, RLS "declutter dropoffs: buyer reads own", 20261017055505; checked live 2026-10-31). The newest
 * one prefills the box; the buyer can change it, and the server geocodes and prices whatever is sent.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

export async function fetchMyLastDropoff(userId: string): Promise<string | null> {
  const rows = unwrap(
    await supabase
      .from("declutter_delivery_dropoffs")
      .select("address, geocoded_at")
      .eq("buyer_id", userId)
      .order("geocoded_at", { ascending: false })
      .limit(1),
  ) as { address: string }[] | null;
  const a = rows?.[0]?.address?.trim();
  return a ? a : null;
}
