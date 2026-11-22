import type { CalloutSettings } from '../../domain/callouts/index.ts';
import type { NoteSuggestion } from '../../domain/links/index.ts';
import type { TagSuggestion } from '../../domain/tags/index.ts';
import type { OpenIn } from '../panes/layout.ts';
import type { EmbedImage } from './image-uploads.ts';

/**
 * What the editor asks of the app, in one object the editor reads through a
 * ref, so it is built once per note and never rebuilt on a render.
 */
export interface EditorBridge {
  /** Notes for a half-typed `[[link`, best first. */
  suggestNotes(query: string): readonly NoteSuggestion[];
  /** Tags for what is typed after `#`: the typed one first, then the vault's own. */
  suggestTags(query: string): readonly TagSuggestion[];
  /** Makes the note a link names (no navigation); for the picker's "Create" row. */
  createLinkedNote(target: string): void;
  followLink(target: string, openIn: OpenIn): void;
  openTag(name: string, openIn: OpenIn): void;
  /** What the webview can show for an image's source, or null when there is none. */
  loadImage(src: string): Promise<string | null>;
  /** Hears which picture sources to load again; returns the way to stop. */
  watchImages(listener: (src: string) => void): () => void;
  /** The vault's callout types now. */
  calloutSettings(): CalloutSettings;
  /** Hears the vault's callout types change; returns the way to stop. */
  watchCallouts(listener: () => void): () => void;
  /** Saves a picture pasted, dropped or picked into the note, and says how the note shows it. */
  embedImage: EmbedImage;
  /** The view was built on `text`, the vault's: saves are based on it. */
  opened(text: string): void;
  /** The text changed: the view hands a reader, not the text, so a keystroke reads nothing. */
  changed(read: () => string): void;
  blurred(): void;
  /** The view is gone (its tab hidden, or switched to the other view): save what waits. */
  closed(): void;
}

/** The bridge as the editor reads it: the latest one handed in, read when used, never during a render. */
export interface LatestBridge {
  get(): EditorBridge;
  set(bridge: EditorBridge): void;
}

export function latestOf(first: EditorBridge): LatestBridge {
  let current = first;
  return {
    get: () => current,
    set: (bridge) => {
      current = bridge;
    },
  };
}
