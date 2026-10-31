/**
 * LEAD-BUNCH-34-SLOW (owner 10-31: 34 photos on an iPhone "takes ages, like it's not even accepting the pictures").
 * The photos just picked show at once, each as soon as its small copy is made, with "Adding 12 of 34…" until every one
 * is ready; the items they make then show under Check each item as each batch is sorted. Before, nothing showed until
 * the first batch had been read, cleaned and sorted.
 */
import { FallbackImg } from "./FallbackImg";

/** "Adding 12 of 34…" while photos are being made ready; null once they all are. */
export function addingLine(ready: number, total: number): string | null {
  if (total <= 0 || ready >= total) return null;
  return `Adding ${ready} of ${total} ${total === 1 ? "photo" : "photos"}…`;
}

export function BunchIntake({ keys, urls, ready, total }: { keys: readonly string[]; urls: ReadonlyMap<string, string>; ready: number; total: number }) {
  const line = addingLine(ready, total);
  if (keys.length === 0 && !line) return null;
  return (
    <div className="space-y-2" data-bunch-intake="">
      {line && <p className="text-sm font-medium text-foreground" role="status" aria-live="polite" data-bunch-adding="">{line}</p>}
      {keys.length > 0 && (
        <ul className="grid grid-cols-5 gap-1.5 sm:grid-cols-8" aria-label="Photos being sorted">
          {keys.map((k) => {
            const url = urls.get(k);
            return (
              <li key={k} className="aspect-square overflow-hidden rounded-lg bg-photo-empty" data-bunch-intake-photo={k}>
                {url && <FallbackImg src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" data-bunch-intake-thumb="" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
