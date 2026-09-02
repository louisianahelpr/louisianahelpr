/**
 * RecipientPicker — ONE smart input that auto-detects whether the sender is
 * typing an email address or a name, rather than making them flip a
 * "search by name" / "enter an email" toggle first (owner, 2026-08-30: the
 * two side-by-side entry points read as one extra decision before the actual
 * task).
 *
 * Detection: anything that matches an email shape (`x@y.z`) is treated as an
 * email — `create-pif-donation` resolves that address directly, unchanged
 * from the original flow. Anything else is treated as a name query and
 * debounced against `search_profiles_by_name`. That RPC is intentionally
 * privacy-narrow (see its migration comment): it returns only `user_id`,
 * `full_name`, `avatar_url` — never email. Selecting a result here only
 * carries `user_id` forward; the edge function resolves the real email
 * server-side with its service-role client.
 */
import { useEffect, useRef, useState } from "react";
import { Search, X as XIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import UserAvatar from "@/components/UserAvatar";
import { formatName } from "@/lib/utils";
import { report } from "@/lib/errorLogger";

export interface RecipientMatch {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
}

const MIN_QUERY_LEN = 2;
const SEARCH_DEBOUNCE_MS = 300;
// An `@` appearing at all is a strong enough signal that the sender is
// mid-way through typing an email (not yet a full match) that a name search
// shouldn't fire underneath them — searching "bob@gm" against full names
// would just churn the RPC for no possible hit.
const LOOKS_EMAIL_ISH = /[@]/;

// `initialsFrom` used to live here. It is now `avatarInitials` inside
// `<UserAvatar>` (`src/lib/avatarImage.ts`), which every avatar surface in the
// app shares — and which additionally rejects a photo that loads fine but
// contains nothing, the case this picker could not see at all.

interface RecipientPickerProps {
  /** Currently selected search result, or null if none / an email is typed instead. */
  selected: RecipientMatch | null;
  onSelect: (match: RecipientMatch) => void;
  onClearSelected: () => void;
  /** "search" = the input resolved to a picked profile; "email" = it resolved to a typed address. */
  mode: "search" | "email";
  onModeChange: (mode: "search" | "email") => void;
  emailValue: string;
  onEmailChange: (value: string) => void;
  emailValid: boolean;
  isSelfGiftEmail: boolean;
}

export function RecipientPicker({
  selected,
  onSelect,
  onClearSelected,
  mode,
  onModeChange,
  emailValue,
  onEmailChange,
  emailValid,
  isSelfGiftEmail,
}: RecipientPickerProps) {
  // Single field of text driving both paths. Seeded from whichever value the
  // parent already carries (e.g. returning to this step with an email
  // already typed), so remounting the picker doesn't lose it.
  const [text, setText] = useState(emailValue);
  const [results, setResults] = useState<RecipientMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards a stale, slower response from clobbering a faster later one.
  const requestSeqRef = useRef(0);

  const trimmed = text.trim();
  const looksLikeEmail = LOOKS_EMAIL_ISH.test(trimmed);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Route the typed text to the right mode as it changes. An "@" anywhere
  // routes to email (even before it's a complete address, so the field
  // never fires a name search on a half-typed email); otherwise it's a name
  // query.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (selected) return; // a result is already picked — text drives nothing further

    if (looksLikeEmail) {
      if (mode !== "email") onModeChange("email");
      onEmailChange(text);
      setResults([]);
      setSearching(false);
      setSearchFailed(false);
      return;
    }

    // Name path.
    if (mode !== "search") onModeChange("search");
    if (emailValue) onEmailChange("");

    if (trimmed.length < MIN_QUERY_LEN) {
      setResults([]);
      setSearching(false);
      setSearchFailed(false);
      return;
    }
    setSearching(true);
    setSearchFailed(false);
    const mySeq = ++requestSeqRef.current;
    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const rows = unwrap(
            await supabase.rpc("search_profiles_by_name", { query: trimmed }),
          ) as RecipientMatch[];
          if (requestSeqRef.current !== mySeq) return; // stale
          setResults(rows);
        } catch (e) {
          if (requestSeqRef.current !== mySeq) return;
          report(e, { severity: "warning", tags: { source: "RecipientPicker.search" } });
          setResults([]);
          setSearchFailed(true);
        } finally {
          if (requestSeqRef.current === mySeq) setSearching(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
     
  }, [text]);

  const handleClear = () => {
    setText("");
    setResults([]);
    onEmailChange("");
    onClearSelected();
  };

  return (
    <div>
      <p className="font-serif italic text-ds-12 mb-2" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Who's this for?
      </p>

      {selected ? (
        <div
          className="w-full rounded-ds-sm py-2 px-3 flex items-center gap-2.5"
          style={{
            background: "hsl(var(--bark) / 0.10)",
            border: "1px solid hsl(var(--bark) / 0.30)",
          }}
        >
          {/* Migrated onto the shared `<UserAvatar>` (2026-08-31). The sender
              is confirming WHO is about to receive money — a blank tinted
              circle here is the one place in the app where a mistaken identity
              costs cash. The previous markup showed the photo whenever
              `avatar_url` was non-null and fell back to initials only when it
              was null, so every blank-but-200 avatar on prod (a flat block, a
              DiceBear frame, a `?d=mp` gravatar) rendered as an empty circle
              and the initials were unreachable. See `src/lib/avatarImage.ts`. */}
          <UserAvatar
            userId={selected.user_id}
            src={selected.avatar_url}
            name={selected.full_name}
            pixelSize={28}
            aria-hidden
            className="w-7 h-7 shrink-0"
            fallbackClassName="text-ds-11 ring-0"
          />
          <p className="flex-1 font-sans text-ds-13 font-semibold truncate" style={{ color: "hsl(var(--ink-deep))" }}>
            {formatName(selected.full_name)}
          </p>
          <button
            type="button"
            aria-label="Clear selected recipient"
            onClick={handleClear}
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full"
            style={{ color: "hsl(var(--olivewood))" }}
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "hsl(var(--olivewood) / 0.6)" }}
          />
          <input
            type="text"
            inputMode="email"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Name or email address…"
            aria-label="Recipient — name or email"
            // min-h-11 is the 44px HIG tap target. The global floor in
            // index.css only covers <button>/[role=button], so this field
            // measured 37px tall — the one control on the screen under the
            // minimum, and the first one anybody touches.
            className="w-full min-h-11 rounded-ds-sm py-2 pl-9 pr-3 text-ds-13 font-sans"
            style={{
              background: "hsl(var(--parchment) / 0.6)",
              border: `0.5px solid hsl(var(--bark) / ${
                looksLikeEmail && trimmed && !emailValid ? "0.4" : "0.22"
              })`,
              color: "hsl(var(--ink-deep))",
              // No `outline: "none"` — an inline one beats the global
              // `:focus-visible` rule and left this field with no visible
              // keyboard focus.
            }}
          />

          {looksLikeEmail ? (
            <>
              {trimmed && !emailValid && (
                <p className="font-serif italic text-ds-11 mt-1.5" style={{ color: "hsl(var(--burnt-sienna))" }}>
                  Enter a valid email address.
                </p>
              )}
              {isSelfGiftEmail && (
                <p className="font-serif italic text-ds-11 mt-1.5" style={{ color: "hsl(var(--burnt-sienna))" }}>
                  You can't send a gift to yourself.
                </p>
              )}
            </>
          ) : (
            <>
              {trimmed.length > 0 && trimmed.length < MIN_QUERY_LEN && (
                <p className="font-serif italic text-ds-11 mt-1.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  Keep typing — at least {MIN_QUERY_LEN} characters, or type a full email address.
                </p>
              )}
              {searchFailed && (
                <p className="font-serif italic text-ds-11 mt-1.5" style={{ color: "hsl(var(--burnt-sienna))" }}>
                  Couldn't search right now. Try again, or type their email address instead.
                </p>
              )}
              {trimmed.length >= MIN_QUERY_LEN && !searchFailed && (
                <div
                  className="mt-1.5 rounded-ds-sm overflow-hidden"
                  style={{ border: "0.5px solid hsl(var(--bark) / 0.18)" }}
                >
                  {searching ? (
                    <div className="py-3 px-3 font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                      Searching…
                    </div>
                  ) : results.length === 0 ? (
                    <div className="py-3 px-3 font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                      No one found. Try a different spelling, or type their email address instead.
                    </div>
                  ) : (
                    results.map((r) => (
                      <button
                        key={r.user_id}
                        type="button"
                        onClick={() => {
                          onSelect(r);
                          setText("");
                          setResults([]);
                        }}
                        className="w-full flex items-center gap-2.5 py-2 px-3 text-left transition-colors"
                        style={{ background: "hsl(var(--parchment) / 0.5)" }}
                      >
                        {/* Same migration as the selected-recipient chip
                            above — and it matters more here: this is the list
                            the sender picks FROM, so several rows rendering as
                            identical blank circles is what makes choosing the
                            wrong person possible. The hashed gradient is
                            seeded from `user_id`, so two different people
                            never collapse into the same block. */}
                        <UserAvatar
                          userId={r.user_id}
                          src={r.avatar_url}
                          name={r.full_name}
                          pixelSize={28}
                          aria-hidden
                          className="w-7 h-7 shrink-0"
                          fallbackClassName="text-ds-11 ring-0"
                        />
                        <p className="font-sans text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
                          {formatName(r.full_name)}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
