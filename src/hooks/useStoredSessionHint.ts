import { useEffect, useState } from "react";
import { hasPersistedAuthToken } from "@/lib/persistedAuthToken";
import { sessionKnown, whenSessionKnown } from "@/lib/sessionKnown";

/**
 * hasPersistedAuthToken() as React state: "is there probably a session?",
 * answered synchronously on the first render and read AGAIN once the native
 * Keychain restore lands (Q1463). In the app, after WebKit evicted
 * localStorage, the first read says "no token" for a signed-in person; the
 * dock then stayed hidden until the network answered and jumped in late.
 * On the web the store is readable from the start, so this is one read.
 */
export function useStoredSessionHint(): boolean {
  const [hint, setHint] = useState(hasPersistedAuthToken);
  useEffect(() => {
    if (sessionKnown()) return;
    let live = true;
    void whenSessionKnown().then(() => { if (live) setHint(hasPersistedAuthToken()); });
    return () => { live = false; };
  }, []);
  return hint;
}
