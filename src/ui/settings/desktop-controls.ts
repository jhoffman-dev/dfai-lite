/** Where the vault syncs, as Settings shows it. */
export interface RemoteInfo {
  readonly url: string;
  /** The upstream branch, e.g. `origin/main`. */
  readonly branch: string;
}

/**
 * What the Mac app offers Settings beyond the browser: the vault folder and
 * the global capture key. The composition root makes it; the UI only calls it.
 */
export interface DesktopControls {
  /** The vault folder open now. */
  readonly vaultPath: string;
  /** Asks for another folder in the Mac's dialog, and reopens the app on it; nothing when dismissed. */
  changeVault(): Promise<void>;
  /** Where the vault syncs; null when it is not a repository with a remote. */
  remote(): Promise<RemoteInfo | null>;
  /** Asks a yes-or-no question in the Mac's own alert; true for `yes`. */
  confirm(question: { message: string; yes: string }): Promise<boolean>;
  /** Makes `accelerator` the capture key and keeps it; rejects when the Mac refuses it. */
  setCaptureHotkey(accelerator: string): Promise<void>;
  /** Draws the window's own chrome in the theme chosen, or the system's for System. */
  followTheme(choice: 'system' | 'light' | 'dark'): void;
}
