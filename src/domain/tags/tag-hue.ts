/** The pastel hues a tag can be drawn in. Gray is left out: a gray tag reads as "not colored". */
export type TagHue = 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red';

const TAG_HUES: readonly TagHue[] = [
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
];

/**
 * A stable hue for a tag: FNV-1a over its folded name, so the same tag is
 * the same color wherever it is shown, in every session. The same hash DFAI
 * colors its tags with, so a vault reads in the same colors in both.
 * Changing the hash recolors every vault; the tests pin it.
 */
export function tagHue(tag: string): TagHue {
  const key = tag.trim().replace(/^#/, '').trim().toLowerCase();
  return TAG_HUES[nameHash(key) % TAG_HUES.length] ?? 'blue';
}

/**
 * 32-bit FNV-1a, finished with murmur3's mix: FNV alone leaves its low bits
 * — the ones a modulus reads — ruled by the last character, so names sharing
 * an ending crowd one hue.
 */
function nameHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}
