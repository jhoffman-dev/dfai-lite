export { refreshPaths, writeFile, type VaultDeps } from './vault-deps.ts';
export { openVault, type OpenedVault } from './open-vault.ts';
export { applyExternalChanges, reloadVault } from './external-changes.ts';
export { createNoteFromLink, createQuickNote } from './create-note.ts';
export { saveNoteText, type SaveNoteRequest, type SaveNoteResult } from './save-note.ts';
export { renameNote, type RenameResult } from './rename-note.ts';
export { renameFolder, type RenameFolderResult } from './rename-folder.ts';
export { deleteNote } from './delete-note.ts';
export { reorderFavorite, toggleFavoriteNote, writeFavorites } from './favorites.ts';
export { AppearanceUnreadableError, setPathAppearance } from './appearance.ts';
export {
  createFolder,
  deleteFolder,
  moveFolderInto,
  moveNoteInto,
  newFolderProblem,
  type CreateFolderResult,
  type DeleteFolderResult,
} from './folders.ts';
export { isEmptyFolder } from './empty-folders.ts';
export {
  embedImage,
  ImageEmbedError,
  ImageRefusedError,
  type EmbedImageDeps,
  type EmbeddedImage,
} from './embed-image.ts';
export { readNoteImage, type NoteImage } from './read-image.ts';
