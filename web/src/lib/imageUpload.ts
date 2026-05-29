// Helpers for accepting image uploads from <input type="file"> and from
// paste events. The caller decides where to wire these — paste handlers
// should be attached to the focused input, not the window, so users
// don't accidentally upload images they paste elsewhere.

export type ImageSelection = {
  file: File;
  previewUrl: string; // object URL — caller must URL.revokeObjectURL() when done
};

const ACCEPTED = /^image\//;

export function selectionFromFileList(files: FileList | null): ImageSelection | null {
  if (!files || files.length === 0) return null;
  const file = files[0];
  if (!ACCEPTED.test(file.type)) return null;
  return { file, previewUrl: URL.createObjectURL(file) };
}

// Pull the first image out of a clipboard paste event. Returns null when
// the clipboard didn't carry an image (so the caller can fall through to
// default text-paste behaviour).
export function selectionFromClipboard(e: ClipboardEvent | React.ClipboardEvent): ImageSelection | null {
  const items = (e.clipboardData ?? (e as unknown as ClipboardEvent).clipboardData)?.items;
  if (!items) return null;
  for (const item of items) {
    if (!ACCEPTED.test(item.type)) continue;
    const file = item.getAsFile();
    if (!file) continue;
    return { file, previewUrl: URL.createObjectURL(file) };
  }
  return null;
}

// Convenience for revoking object URLs on cleanup.
export function revokeSelection(sel: ImageSelection | null) {
  if (sel?.previewUrl) {
    try { URL.revokeObjectURL(sel.previewUrl); } catch { /* ignore */ }
  }
}
