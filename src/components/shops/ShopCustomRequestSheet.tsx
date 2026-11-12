/**
 * Custom orders (20261106202917): on a shop's page, a member asks the shop for something made to order. Shown only
 * while the shop takes custom orders (shops.custom_orders, the shop's own setting) and never to the owner; the
 * server checks every rule again (shops_send_custom_request). The shop is told and answers with a price.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchCustomOrders } from "@/lib/shops/orders";
import { CUSTOM_REQUEST_MAX, sendCustomRequest } from "@/lib/shops/customRequests";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { ShopCard } from "./ShopProfile";

export default function ShopCustomRequestSheet({ shopId }: { shopId: string }) {
  const mode = useQuery({ queryKey: ["shops", "custom-orders", shopId], queryFn: () => fetchCustomOrders(shopId) });
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const send = useMutation({
    mutationFn: () => sendCustomRequest(shopId, text, null),
    onSuccess: () => {
      setSent(true);
      setText("");
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  // Off, not loaded, or unreadable: nothing to offer (the shop's page stands without it).
  if (!mode.data || mode.data === "off") return null;
  const trimmed = text.trim();
  return (
    <ShopCard id="shop-custom-request" title="Ask for a custom order">
      {sent ? (
        <div className="space-y-2" role="status">
          <p className="text-ds-13">Sent. The shop will answer with a price, and you can order it from there.</p>
          <Button type="button" variant="outline" onClick={() => setSent(false)}>Ask for something else</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-ds-13 text-muted-foreground">
            {/* Half up front is hidden while deposit_not_ready is on (shops audit 11-08 #1): every request is paid in full. */}
            Describe what you&apos;d like. If you order the shop&apos;s price, it&apos;s paid like any other order.
          </p>
          <Label htmlFor="shop-custom-request-text">What you'd like</Label>
          <Textarea
            id="shop-custom-request-text"
            value={text}
            maxLength={CUSTOM_REQUEST_MAX}
            onChange={(e) => setText(e.target.value)}
            placeholder="Size, colors, flavors, and when you need it"
          />
          <p className="text-ds-11 text-muted-foreground">{text.length}/{CUSTOM_REQUEST_MAX}. No phone numbers, emails or links.</p>
          <Button type="button" className="btn-grad-primary w-full" disabled={!trimmed || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? "Sending…" : "Send to the shop"}
          </Button>
        </div>
      )}
    </ShopCard>
  );
}
