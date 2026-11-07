/** The gift card tab's two lists, sent by me and sent to me (moved out of GiftCard.tsx, Q806; code unchanged). */
import { useQuery } from "@tanstack/react-query";
import { fetchReceivedGiftCards, fetchSentGiftCards } from "./giftCardQueries";

export function useGiftCardLists(user: { id: string } | null | undefined, myEmail: string) {
  // ── Queries ───────────────────────────────────────────────────────────────
  // isError is load-bearing on both lists: these are real, paid gift cards.
  // A failed fetch collapses to [] and would otherwise render the "nothing
  // here yet" empty state — telling someone their unredeemed money doesn't
  // exist. A failure must read as a failure, with a way back.
  const {
    data: myDonated = [],
    isLoading: loadingDonated,
    isError: donatedFailed,
    isFetching: donatedFetching,
    refetch: refetchDonated,
    status: donatedStatus,
    fetchStatus: donatedFetchStatus,
  } = useQuery({
    queryKey: ["gift-cards-sent", user?.id],
    queryFn: () => (user?.id ? fetchSentGiftCards(user.id) : Promise.resolve([])),
    enabled: !!user?.id,
  });

  // Gifts sent TO me — matched by resolved recipient_id OR my named email, since
  // a gift I haven't claimed yet has recipient_id = null but is visible to my
  // email via RLS. Newest first.
  const {
    data: myReceived = [],
    isLoading: loadingReceived,
    isError: receivedFailed,
    isFetching: receivedFetching,
    refetch: refetchReceived,
    status: receivedStatus,
    fetchStatus: receivedFetchStatus,
  } = useQuery({
    queryKey: ["gift-cards-received", user?.id, myEmail],
    queryFn: () => (user?.id ? fetchReceivedGiftCards(user.id, myEmail) : Promise.resolve([])),
    enabled: !!user?.id,
  });

  return {
    myDonated, loadingDonated, donatedFailed, donatedFetching, refetchDonated, donatedStatus, donatedFetchStatus,
    myReceived, loadingReceived, receivedFailed, receivedFetching, refetchReceived, receivedStatus, receivedFetchStatus,
  };
}
