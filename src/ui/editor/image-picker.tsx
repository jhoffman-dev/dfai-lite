import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { IMAGE_PICKER_ACCEPT } from '../../application/index.ts';
import { addImages, type EmbedImage } from './image-uploads.ts';
import { IMAGE_REQUEST } from './slash-commands.ts';

/**
 * The file picker the "Image" slash command opens, as DFAI's: one or more
 * pictures, put in where `/image` was typed, each saved as a paste or drop is.
 */
export function ImagePicker({ editor, embed }: { editor: Editor | null; embed: EmbedImage }) {
  const picker = useRef<HTMLInputElement>(null);

  // Heard on the note around the editor, where the request bubbles up to:
  // the editor's own element is not there until it has mounted.
  useEffect(() => {
    const around = picker.current?.parentElement;
    if (around === null || around === undefined) return;
    const answer = () => picker.current?.click();
    around.addEventListener(IMAGE_REQUEST, answer);
    return () => around.removeEventListener(IMAGE_REQUEST, answer);
  }, []);

  const addPicked = (input: HTMLInputElement) => {
    const files = [...(input.files ?? [])];
    // Cleared, so picking the same file again still counts as a choice.
    input.value = '';
    if (editor === null || editor.isDestroyed || files.length === 0) return;
    addImages(editor, { files, at: editor.state.selection.from, origin: 'file', embed });
  };

  return (
    <input
      ref={picker}
      hidden
      type="file"
      accept={IMAGE_PICKER_ACCEPT}
      multiple
      aria-label="Choose an image"
      tabIndex={-1}
      onChange={(event) => addPicked(event.currentTarget)}
    />
  );
}
