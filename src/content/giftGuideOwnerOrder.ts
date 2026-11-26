/**
 * Owner picks first in each price section (guides audit 1126: "stocking stuffers under $10, then the price bands, low to
 * high, owner picks first in each band"). On a themed guide the picks the owner sent herself (`ownerAdd`) lead their
 * section, in the order they already had; the rest follow in theirs. Her, Him and Kids are all her picks (none carries
 * `ownerAdd`), so their order is unchanged. Works on any run of rows grouped by sectionId.
 */
export const ownerAddsFirst = <T extends { sectionId?: string; ownerAdd?: true }>(picks: readonly T[]): T[] => {
  const out: T[] = [];
  let i = 0;
  while (i < picks.length) {
    let j = i;
    while (j < picks.length && picks[j].sectionId === picks[i].sectionId) j += 1;
    const run = picks.slice(i, j);
    out.push(...run.filter((p) => p.ownerAdd), ...run.filter((p) => !p.ownerAdd));
    i = j;
  }
  return out;
};
