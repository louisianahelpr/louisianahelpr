/**
 * The head of You › Money while its tile's reads are out (HomeMoneyTiles, placement "money"): one tile's frame.
 * EarningsPageSkeleton draws it too, so the page's first frame (the tab's chunk still loading) already has it.
 * Q2708 (11-06): it used to appear above the wallet bones only once EarningsTab ran (lab shift at ~1.3 s).
 * Its own file, with no imports, so the skeleton does not pull HomeMoneyTiles' graph onto its chunk.
 */
export function MoneyTilesLoading() {
  return (
    <div data-home-money="money" data-money-loading="" aria-hidden="true" className="grid grid-cols-2 gap-3">
      <div className="liquid-glass p-card lg:p-4 flex flex-col gap-0.5 col-span-2 animate-pulse">
        <span className="text-ds-13 invisible">&nbsp;</span>
        <span className="text-ds-24 font-bold leading-tight invisible">&nbsp;</span>
        <span className="text-ds-13 leading-snug invisible">&nbsp;</span>
      </div>
    </div>
  );
}
