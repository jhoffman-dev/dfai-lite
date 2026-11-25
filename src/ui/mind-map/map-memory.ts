import type { MapTrail, MapView } from '../../domain/mind-map/index.ts';

/**
 * What a map tab keeps while another tab shows (a hidden tab mounts
 * nothing): the trail walked, how far each root was opened, and whether
 * transcripts show. Kept for the session, by tab, as `workspace.memoryOf` keeps scroll.
 */
interface MapMemory {
  trail: MapTrail | null;
  readonly views: Map<string, MapView>;
  transcripts: boolean;
}

const memories = new Map<string, MapMemory>();

function memoryOf(tabId: string): MapMemory {
  let kept = memories.get(tabId);
  if (kept === undefined) {
    kept = { trail: null, views: new Map(), transcripts: false };
    memories.set(tabId, kept);
  }
  return kept;
}

export const keptTrail = (tabId: string) => memoryOf(tabId).trail;
export const keepTrail = (tabId: string, trail: MapTrail) => void (memoryOf(tabId).trail = trail);
export const keptView = (tabId: string, rootKey: string) => memoryOf(tabId).views.get(rootKey);
export const keepView = (tabId: string, rootKey: string, view: MapView) =>
  void memoryOf(tabId).views.set(rootKey, view);
export const keptTranscripts = (tabId: string) => memoryOf(tabId).transcripts;
export const keepTranscripts = (tabId: string, shown: boolean) =>
  void (memoryOf(tabId).transcripts = shown);
