// Derive progressive-loading variant URLs from a node/cover image URL.
//
// The server writes JPEG variants next to each PNG: <hash>.blur.jpg /
// <hash>.thumb.jpg / <hash>.medium.jpg (see server imageVariants.js). Their
// URLs are the original image URL with the `.png` extension swapped for the
// variant suffix. Variants only exist for real PNGs — SVG fallbacks (and
// pre-variant legacy nodes) have none, so callers must tolerate a 404 and
// fall back to the original.

export type VariantName = 'blur' | 'thumb' | 'medium';

// True only for raster PNG URLs (the only kind that has variants). SVG
// fallbacks and anything else return false → callers skip progressive logic.
export function hasVariants(url: string | null | undefined): boolean {
  return !!url && /\.png(\?|$)/i.test(url);
}

// Swap the `.png` for a variant suffix, preserving any query string.
export function variantUrl(url: string, name: VariantName): string {
  return url.replace(/\.png(\?|$)/i, `.${name}.jpg$1`);
}
