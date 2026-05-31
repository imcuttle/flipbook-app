// Copy text to the clipboard across browsers, including Safari/iOS and
// insecure (http LAN) contexts where navigator.clipboard is unavailable or
// throws.
//
// We delegate to `clipboard-polyfill`, which picks the best available
// strategy per browser (async Clipboard API → execCommand → Safari-specific
// fallbacks). Returns true on success, false if every strategy failed.
import * as clipboard from 'clipboard-polyfill';

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
