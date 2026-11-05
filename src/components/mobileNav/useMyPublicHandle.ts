import { useQuery } from "@tanstack/react-query";
import { handleForUser } from "@/lib/profileLink/api";

/**
 * The signed-in viewer's own public handle, read ONLY while they are on a /u/<handle> page, so the Profile tab can
 * light on their own page (owner 11-05; /user/<me> forwards there). Read-only (handle_for_user, never
 * rpc_ensure_my_handle, which may make one) and on the same key as PublicProfileForward, so a forward that just
 * happened costs no second read. Null while unknown, signed out, on another page or on any failure: the tab stays dark.
 * Guard: src/test/profileTabLitOnOwnPage.test.ts.
 */
export function useMyPublicHandle(userId: string | null | undefined, pathname: string): string | null {
  const id = userId ? userId.toLowerCase() : null;
  const { data } = useQuery({
    queryKey: ["handle-for-user", id],
    queryFn: () => handleForUser(id as string),
    enabled: !!id && pathname.startsWith("/u/"),
    staleTime: 5 * 60_000,
  });
  return data?.state === "found" ? data.handle : null;
}
