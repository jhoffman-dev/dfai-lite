/**
 * Whether the webview can draw an image. Asked before an image is saved, so a
 * HEIC photo on a Mac that cannot show one — or a file that only claims to be
 * an image — is refused instead of saved and shown as missing.
 */
export interface ImageProbe {
  canShow(image: { readonly bytes: Uint8Array; readonly mimeType: string }): Promise<boolean>;
}
