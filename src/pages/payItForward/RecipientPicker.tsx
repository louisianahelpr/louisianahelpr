/**
 * RecipientPicker — lets a gift sender find the recipient by NAME instead of
 * typing an email, via the `search_profiles_by_name` RPC. That RPC is
 * intentionally privacy-narrow (see its migration comment): it returns only
 * `user_id`, `full_name`, `avatar_url` — never email. Selecting a result here
 * only carries `user_id` forward; `create-pif-donation` resolves the real
 * email server-side with its service-role client, exactly mirroring what
 * happens today when someone types an email by hand.
 *
 * A "type an email instead" fallback stays available — some recipients won't
 * have a full_name set, or the sender may not find them by name (common-name
 * collisions, nicknames, etc).
 */
import { useEffect, useRef, useState } from "react";
import { Search, X as XIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { formatName } from "@/lib/utils";
import { report } from "@/lib/errorLogger";

export interface RecipientMatch {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
}

const MIN_QUERY_LEN = 2;
const SEARCH_DEBOUNCE_MS = 300;

function initialsFrom(name: string | null): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

interface RecipientPickerProps {
  /** Currently selected search result, or null if none / typing an email instead. */
  selected: RecipientMatch | null;
  onSelect: (match: RecipientMatch) => void;
  onClearSelected: () => void;
  /** "search" shows the name search; "email" shows the typed-email fallback. */
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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RecipientMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards a stale, slower response from clobbering a faster later one.
  const requestSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
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
  }, [query]);

  if (mode === "email") {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Recipient's email
          </p>
          <button
            type="button"
            onClick={() => onModeChange("search")}
            className="font-sans text-ds-11 font-semibold underline underline-offset-2"
            style={{ color: "hsl(var(--olivewood))" }}
          >
            Search by name instead
          </button>
        </div>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={emailValue}
          onChange={(e) => onEmailChange(e.target.value)}
          aria-label="Recipient's email"
          className="w-full rounded-ds-sm py-2 px-3 text-ds-13 font-sans"
          style={{
            background: "hsl(var(--parchment) / 0.6)",
            border: `0.5px solid hsl(var(--bark) / ${emailValue && !emailValid ? "0.4" : "0.22"})`,
            color: "hsl(var(--ink-deep))",
            outline: "none",
          }}
        />
        {emailValue.trim() && !emailValid && (
          <p className="font-serif italic text-ds-11 mt-1.5" style={{ color: "hsl(var(--burnt-sienna))" }}>
            Enter a valid email address.
          </p>
        )}
        {isSelfGiftEmail && (
          <p className="font-serif italic text-ds-11 mt-1.5" style={{ color: "hsl(var(--burnt-sienna))" }}>
            You can't send a gift to yourself.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Who's this for?
        </p>
        <button
          type="button"
          onClick={() => onModeChange("email")}
          className="font-sans text-ds-11 font-semibold underline underline-offset-2"
          style={{ color: "hsl(var(--olivewood))" }}
        >
          Enter an email instead
        </button>
      </div>

      {selected ? (
        <div
          className="w-full rounded-ds-sm py-2 px-3 flex items-center gap-2.5"
          style={{
            background: "hsl(var(--bark) / 0.10)",
            border: "1px solid hsl(var(--bark) / 0.30)",
          }}
        >
          <div
            className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center overflow-hidden font-sans text-ds-11 font-semibold"
            style={{ background: "hsl(var(--bark) / 0.20)", color: "hsl(var(--bark))" }}
          >
            {selected.avatar_url ? (
              <OptimizedImage
                src={selected.avatar_url}
                alt=""
                className="w-full h-full object-cover"
                width={28}
                height={28}
              />
            ) : (
              initialsFrom(selected.full_name)
            )}
          </div>
          <p className="flex-1 font-sans text-ds-13 font-semibold truncate" style={{ color: "hsl(var(--ink-deep))" }}>
            {formatName(selected.full_name)}
          </p>
          <button
            type="button"
            aria-label="Clear selected recipient"
            onClick={onClearSelected}
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            aria-label="Search for a recipient by name"
            className="w-full rounded-ds-sm py-2 pl-9 pr-3 text-ds-13 font-sans"
            style={{
              background: "hsl(var(--parchment) / 0.6)",
              border: "0.5px solid hsl(var(--bark) / 0.22)",
              color: "hsl(var(--ink-deep))",
              outline: "none",
            }}
          />
          {query.trim().length > 0 && query.trim().length < MIN_QUERY_LEN && (
            <p className="font-serif italic text-ds-11 mt-1.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Keep typing — at least {MIN_QUERY_LEN} characters.
            </p>
          )}
          {searchFailed && (
            <p className="font-serif italic text-ds-11 mt-1.5" style={{ color: "hsl(var(--burnt-sienna))" }}>
              Couldn't search right now. Try again, or enter an email instead.
            </p>
          )}
          {query.trim().length >= MIN_QUERY_LEN && !searchFailed && (
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
                  No one found. Try a different spelling, or enter an email instead.
                </div>
              ) : (
                results.map((r) => (
                  <button
                    key={r.user_id}
                    type="button"
                    onClick={() => {
                      onSelect(r);
                      setQuery("");
                      setResults([]);
                    }}
                    className="w-full flex items-center gap-2.5 py-2 px-3 text-left transition-colors"
                    style={{ background: "hsl(var(--parchment) / 0.5)" }}
                  >
                    <div
                      className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center overflow-hidden font-sans text-ds-11 font-semibold"
                      style={{ background: "hsl(var(--bark) / 0.15)", color: "hsl(var(--bark))" }}
                    >
                      {r.avatar_url ? (
                        <OptimizedImage
                          src={r.avatar_url}
                          alt=""
                          className="w-full h-full object-cover"
                          width={28}
                          height={28}
                        />
                      ) : (
                        initialsFrom(r.full_name)
                      )}
                    </div>
                    <p className="font-sans text-ds-13" style={{ color: "hsl(var(--ink-deep))" }}>
                      {formatName(r.full_name)}
                    </p>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
