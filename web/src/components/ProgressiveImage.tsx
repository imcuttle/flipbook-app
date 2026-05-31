import { useEffect, useRef, useState } from 'react';
import styles from '../styles/ProgressiveImage.module.css';
import { hasVariants, variantUrl, type VariantName } from '../lib/imageVariants';

type Props = {
  // The original PNG/SVG URL (full-resolution). Variants are derived from it.
  src: string;
  alt?: string;
  className?: string;
  // Clear image to load over the blur placeholder. 'thumb' for gallery
  // cards, 'medium' for the canvas first-paint. Ignored when the src has no
  // variants (SVG / legacy) — we load the original directly.
  target?: VariantName;
  // After the target loads, also upgrade to the full-resolution original.
  // Used on the canvas (click precision / OCR alignment need the real PNG).
  upgradeToFull?: boolean;
  // object-fit for the sharp image: 'cover' for gallery thumbnails,
  // 'contain' for the canvas (keep the whole annotated diagram visible).
  objectFit?: 'cover' | 'contain';
  // Forwarded to the final (sharp) <img> so callers like the canvas can
  // measure the painted image.
  imgRef?: React.Ref<HTMLImageElement>;
  draggable?: boolean;
};

// Blur-up progressive image. Renders a tiny blurred LQIP instantly, loads the
// clear image (thumb/medium) underneath, and cross-fades the blur away once
// it's decoded. Optionally upgrades to the full-res original afterwards.
//
// Robust to MISSING variants: if a variant fails to load — whether because it
// hasn't been generated yet (legacy node), 404s, or is blocked by an ad/asset
// blocker — we transparently fall back to the original `src`. We NEVER let a
// failed <img> render the browser's broken-image glyph: failed layers hide
// themselves.
export function ProgressiveImage({
  src,
  alt = '',
  className,
  target = 'medium',
  upgradeToFull = false,
  objectFit = 'cover',
  imgRef,
  draggable = false,
}: Props) {
  const canVary = hasVariants(src);
  const blurSrc = canVary ? variantUrl(src, 'blur') : null;
  // The clear image we aim to display. Without variants, that's the original.
  const targetSrc = canVary ? variantUrl(src, target) : src;

  // Current "sharp" source actually shown (starts at target, may upgrade or
  // fall back to the original on error).
  const [sharpSrc, setSharpSrc] = useState(targetSrc);
  const [sharpLoaded, setSharpLoaded] = useState(false);
  // True only when even the ORIGINAL failed — then we render nothing (no
  // broken-image glyph).
  const [sharpDead, setSharpDead] = useState(false);
  // Blur lifecycle: loaded (fade in) / dead (blocked or missing → hide). It
  // starts transparent so a blocked/broken blur never flashes the browser's
  // broken-image glyph before onError fires.
  const [blurLoaded, setBlurLoaded] = useState(false);
  const [blurDead, setBlurDead] = useState(false);

  // Reset synchronously when the underlying image changes (e.g. navigating
  // nodes) so we never flash the previous node's picture.
  const lastKey = useRef(src);
  if (lastKey.current !== src) {
    lastKey.current = src;
    setSharpSrc(targetSrc);
    setSharpLoaded(false);
    setSharpDead(false);
    setBlurLoaded(false);
    setBlurDead(false);
  }

  // After the target loads, optionally swap up to the full-res original.
  useEffect(() => {
    if (!upgradeToFull || !canVary || !sharpLoaded) return;
    if (sharpSrc === src) return; // already full-res
    const full = new Image();
    full.onload = () => setSharpSrc(src);
    full.src = src;
    return () => { full.onload = null; };
  }, [upgradeToFull, canVary, sharpLoaded, sharpSrc, src]);

  const fitClass = objectFit === 'contain' ? styles.fitContain : styles.fitCover;

  return (
    <div className={`${styles.wrap} ${className ?? ''}`}>
      {blurSrc && !blurDead && !sharpLoaded && (
        <img
          className={`${styles.blur} ${fitClass} ${blurLoaded ? styles.sharpVisible : ''}`}
          src={blurSrc}
          alt=""
          aria-hidden
          draggable={false}
          onLoad={() => setBlurLoaded(true)}
          // Blur blocked / missing → hide it; the (transparent) sharp layer
          // still loads underneath. No broken-image glyph.
          onError={() => setBlurDead(true)}
        />
      )}
      {!sharpDead && (
        <img
          ref={imgRef}
          className={`${styles.sharp} ${fitClass} ${sharpLoaded ? styles.sharpVisible : ''}`}
          src={sharpSrc}
          alt={alt}
          draggable={draggable}
          onLoad={() => setSharpLoaded(true)}
          onError={() => {
            // Variant blocked / missing (404, ad-blocker, not-yet-generated):
            // fall back to the original. If the ORIGINAL itself fails, give up
            // and hide the layer rather than show a broken-image glyph.
            if (sharpSrc !== src) {
              setSharpLoaded(false);
              setSharpSrc(src);
            } else {
              setSharpDead(true);
            }
          }}
        />
      )}
    </div>
  );
}
