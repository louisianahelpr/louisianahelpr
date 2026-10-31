/**
 * The photo being dragged on Sell a bunch. Read from here, not the drag event: a browser hides a drag's data until the
 * drop, and an item must know during the drag whether this is its own photo. Empty for a file dragged in from the computer.
 */
export interface BunchPhotoInDrag {
  photo: string;
  item: string;
}

let dragging: BunchPhotoInDrag | null = null;

export const bunchPhotoDrag = {
  start: (d: BunchPhotoInDrag) => {
    dragging = d;
  },
  end: () => {
    dragging = null;
  },
  current: () => dragging,
};
