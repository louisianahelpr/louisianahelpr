/**
 * LEAD-BUNCH-34-SLOW (owner, 10-31): Sell a bunch's early upload, the same scheme as the one-item form
 * (LEAD-POST-SLOW (a)). Once a photo is sorted into an item, that item gets the id its draft will be created with
 * (declutter_create_item_with_id, 20261031160546) and the photo goes up into that id's folder at once.
 * ONE id per item (lead, 10-31): that id is the item's saved app id (BunchItem.appId, LEAD-RESUME-REPOSTS). An item
 * that already has one uses it; one formed without it gets a new id here, which sync hands back so the screen saves it
 * on the item before anything is sent, and listing makes the draft with it. By the time
 * the seller taps List, listing only creates the draft with that id, attaches the photos already up and publishes.
 *
 * Never in the way: a photo that could not go up early (or a draft that got another id, before that migration is on
 * prod) is uploaded at listing exactly as before. A photo moved to another item, or an item dropped, has its early
 * copy removed again, best effort.
 */
import type { BunchItem } from "@/lib/declutter/bunch";
import { dropStagedPhotos, stageBunchPhoto } from "@/lib/declutter/api";

/** What listBunch asks of the early uploads. */
export interface EarlyUploads {
  /** The id a NEW draft for this item should be created with, or undefined (no early upload for it). */
  idFor(itemKey: string): string | undefined;
  /** The photo's early copy in this draft's folder, once it is up; null when there is none (it goes up at listing). */
  path(itemId: string, photoKey: string): Promise<string | null>;
  /** The copy was attached (or is no longer wanted): never handed out again. */
  used(itemId: string, photoKey: string): void;
}

/** Photos going up at once while the seller sorts: the phone's upload is the limit, and the photo tool shares it. */
const STAGE_AT_ONCE = 3;

type StageOne = (sellerId: string, itemId: string, file: File) => Promise<string | null>;
type DropMany = (paths: string[]) => Promise<void>;

const slot = (itemId: string, photoKey: string) => `${itemId}|${photoKey}`;

export class BunchStager implements EarlyUploads {
  private readonly ids = new Map<string, string>();
  private readonly staged = new Map<string, Promise<string | null>>();
  private readonly waiting: (() => void)[] = [];
  private running = 0;

  constructor(
    private readonly sellerId: string,
    private readonly stageOne: StageOne = stageBunchPhoto,
    private readonly dropMany: DropMany = dropStagedPhotos,
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly atOnce = STAGE_AT_ONCE,
  ) {}

  idFor(itemKey: string): string | undefined {
    return this.ids.get(itemKey);
  }

  path(itemId: string, photoKey: string): Promise<string | null> {
    return this.staged.get(slot(itemId, photoKey)) ?? Promise.resolve(null);
  }

  used(itemId: string, photoKey: string): void {
    this.staged.delete(slot(itemId, photoKey));
  }

  /**
   * Bring the early copies in line with the items on screen: each photo of each sorted item starts going up into its
   * item's folder (its draft's once made, else its app id's), and a copy no item holds there any more is removed.
   * Returns the app ids given out now (item key -> id), for the screen to save on those items.
   */
  sync(items: readonly BunchItem[], files: ReadonlyMap<string, File>): Map<string, string> {
    const wanted = new Set<string>();
    const given = new Map<string, string>();
    for (const it of items) {
      if (it.notSorted) continue;
      let id = it.draftId ?? it.appId ?? this.ids.get(it.key);
      if (!id) {
        id = this.newId();
        given.set(it.key, id);
      }
      if (!it.draftId) this.ids.set(it.key, it.appId ?? id);
      for (const k of it.photoKeys) {
        // Already on its draft: nothing to send.
        if (it.uploaded && k in it.uploaded) continue;
        const file = files.get(k);
        if (!file) continue;
        const at = slot(id, k);
        wanted.add(at);
        if (!this.staged.has(at)) this.staged.set(at, this.queued(id, file));
      }
    }
    const gone = [...this.staged.entries()].filter(([at]) => !wanted.has(at));
    for (const [at] of gone) this.staged.delete(at);
    if (gone.length > 0) {
      void Promise.all(gone.map(([, p]) => p)).then((paths) => this.dropMany(paths.filter((p): p is string => !!p)));
    }
    const keys = new Set(items.map((it) => it.key));
    for (const k of [...this.ids.keys()]) if (!keys.has(k)) this.ids.delete(k);
    return given;
  }

  private async queued(itemId: string, file: File): Promise<string | null> {
    if (this.running >= this.atOnce) await new Promise<void>((go) => this.waiting.push(go));
    this.running += 1;
    try {
      return await this.stageOne(this.sellerId, itemId, file);
    } catch (err) {
      // Not silent: the photo is uploaded at listing instead.
      console.warn("[declutter] early bunch photo upload did not start; it goes up at listing", err);
      return null;
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }
}
