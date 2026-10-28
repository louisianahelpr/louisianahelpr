import { fetchDeliveryRaiseStatus } from "./deliveryRaise";

/**
 * The one raise read, shared by the panel, the delivery card and Buying's order list, so whichever mounts first
 * starts it and the panel reads the cache (audit 2 A2-7 / B2-3, 2026-10-28: "Raise the pay" took more than 10 s to
 * appear on Buying; it was read only once the order's details were open and the delivery had loaded).
 */
export const deliveryRaiseQuery = (orderId: string) => ({
  queryKey: ["declutter", "delivery-raise", orderId] as const,
  queryFn: () => fetchDeliveryRaiseStatus(orderId),
});
