import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from '../styles/Canvas.module.css';
import type { Node, PendingClick, Tree } from '../state/types';
import { HotspotCard } from './HotspotCard';
import { SourcesBadge } from './SourcesBadge';
import { TreeBadge } from './TreeBadge';
import { LongPressIndicator } from './LongPressIndicator';
import { TextLayer } from './TextLayer';
import { Icon } from './Icon';
import { imageUrl } from '../lib/api';
import { clamp01, pct } from '../lib/geometry';
import { layOutHotspots } from '../lib/layout';
import { useLang, t } from '../lib/i18n';

const MAX_PARALLEL_PER_NODE = 4;
const LONG_PRESS_MS = 1000;
const MOVE_CANCEL_PX = 10;

type Props = {
  canvasId: string;
  node: Node | null;
  tree: Tree | null;
  imageLoading: boolean;
  pendingClicks: PendingClick[]; // for THIS node
  readOnly: boolean;
  showChrome: boolean;
  showLabels: boolean;
  fullscreen: boolean;
  enterMode?: 'drill' | 'up' | 'fade' | 'none';
  originXY?: [number, number]; // 0..1, used as transform-origin for drill enter
  onImageClick: (xy: [number, number]) => void;
  onHotspotClick: (index: number) => void;
  onHotspotDelete?: (index: number) => void;
  onJumpToHash?: (hash: string) => void;
  // Optional inline overlay rendered on top of the stage (e.g. floating
  // click composer panel). Rendered inside the stage so its absolute
  // positioning is relative to the stage rect.
  overlay?: React.ReactNode;
  // Lets the App convert image-relative xy → stage-relative xy via the
  // imageRect this component computes. Called whenever imageRect changes.
  onImageRectChange?: (rect: { left: number; top: number; width: number; height: number } | null) => void;
};

const PHASE_KEY: Record<PendingClick['phase'], 'phase.planning' | 'phase.image' | 'phase.finalizing'> = {
  planning: 'phase.planning',
  image_loading: 'phase.image',
  finalizing: 'phase.finalizing',
};

export function Canvas({ canvasId, node, tree, imageLoading, pendingClicks, readOnly, showChrome, showLabels, fullscreen, enterMode = 'none', originXY, onImageClick, onHotspotClick, onHotspotDelete, onJumpToHash, overlay, onImageRectChange }: Props) {
  const [lang] = useLang();
  const hasImage = !!node?.image;
  const src = node?.image ? imageUrl(canvasId, node.image) : '';
  const isSvg = src.endsWith('.svg');
  const atCapacity = pendingClicks.length >= MAX_PARALLEL_PER_NODE;
  const interactive = !readOnly && hasImage && !imageLoading && !atCapacity;

  // Long-press tracking. Click became "press and hold for 1 s" — gives users
  // an explicit Are-you-sure moment and prevents accidental drilldown clicks.
  const [pressXY, setPressXY] = useState<[number, number] | null>(null);
  const pressTimerRef = useRef<number | null>(null);
  const pressStartPxRef = useRef<{ x: number; y: number } | null>(null);

  const cancelPress = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    pressStartPxRef.current = null;
    setPressXY(null);
  };

  // Cleanup on unmount or when interactivity is lost.
  useEffect(() => () => cancelPress(), []);
  useEffect(() => { if (!interactive) cancelPress(); }, [interactive]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || !node) return;
    // Ignore non-primary buttons (right click etc.)
    if (e.button !== undefined && e.button !== 0) return;
    // If the pointerdown landed on a TextLayer span, the user is selecting
    // text — don't start a long-press timer. (`closest` walks up the DOM so
    // it works even if the target is a child node of the span.)
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('[data-textspan="1"]')) return;
    const stage = e.currentTarget.getBoundingClientRect();
    const sxRel = (e.clientX - stage.left) / stage.width;
    const syRel = (e.clientY - stage.top) / stage.height;
    // Convert from stage-relative to *image-relative* xy. The painted image
    // is letterboxed inside the 16:9 stage when its aspect ratio differs
    // (e.g. 2752×1536 ≈ 1.79 vs 1.78); without this correction the click
    // coordinate sent to the server drifts vs the actual picture, and the
    // pending-click bubble visually misaligns with the cursor in fullscreen.
    const xy: [number, number] = stageToImage([sxRel, syRel]);
    pressStartPxRef.current = { x: e.clientX, y: e.clientY };
    setPressXY(xy);
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null;
      setPressXY(null);
      pressStartPxRef.current = null;
      onImageClick(xy);
    }, LONG_PRESS_MS);
    // Capture so we still get pointermove / pointerup if the cursor leaves the
    // stage briefly (e.g. drifts onto a hotspot card).
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pressTimerRef.current === null || !pressStartPxRef.current) return;
    const dx = e.clientX - pressStartPxRef.current.x;
    const dy = e.clientY - pressStartPxRef.current.y;
    if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) cancelPress();
  };

  const handlePointerUp = () => {
    // Released before the long-press fired → cancel.
    cancelPress();
  };

  // Refs needed by both the imageRect measurement and the leader-line
  // measurement below. Declared up-front so hook call order stays stable.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // --- Image rect inside the stage (object-fit: contain letterboxes when
  // image aspect ≠ stage aspect). Used for two things:
  //   (1) TextLayer overlay alignment.
  //   (2) Converting between stage-relative pointer coordinates and
  //       image-relative xy. Hotspot anchor/leader and click_xy are stored
  //       in image space (0..1 inside the painted picture); without this
  //       conversion they drift by the letterbox amount, which is small
  //       in normal mode (~0.7%) but grows in fullscreen when the wrapper
  //       aspect deviates further from 16:9.
  const [imageRect, setImageRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [stageHeightPx, setStageHeightPx] = useState(0);

  useLayoutEffect(() => {
    if (!stageRef.current || !hasImage || isSvg) {
      if (imageRect !== null) setImageRect(null);
      return;
    }
    const measure = () => {
      const stageRect = stageRef.current?.getBoundingClientRect();
      if (!stageRect || stageRect.width === 0 || stageRect.height === 0) return;
      setStageHeightPx(stageRect.height);
      // We know the image's pixel dims (server-supplied). Compute the
      // contained rect: scale uniformly to fit stage, centre.
      const iw = node?.image_w;
      const ih = node?.image_h;
      if (!iw || !ih) {
        // Without server-supplied dims, assume the image fills the stage 1:1.
        setImageRect({ left: 0, top: 0, width: 100, height: 100 });
        return;
      }
      const stageAspect = stageRect.width / stageRect.height;
      const imgAspect = iw / ih;
      let renderedWPct = 100;
      let renderedHPct = 100;
      let leftPct = 0;
      let topPct = 0;
      if (imgAspect > stageAspect) {
        // image is wider than stage → fills width, letterbox top/bottom
        renderedWPct = 100;
        renderedHPct = (stageAspect / imgAspect) * 100;
        leftPct = 0;
        topPct = (100 - renderedHPct) / 2;
      } else if (imgAspect < stageAspect) {
        // image is taller than stage → fills height, pillarbox left/right
        renderedHPct = 100;
        renderedWPct = (imgAspect / stageAspect) * 100;
        topPct = 0;
        leftPct = (100 - renderedWPct) / 2;
      }
      setImageRect({ left: leftPct, top: topPct, width: renderedWPct, height: renderedHPct });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // showChrome and fullscreen change the stage's height (the title /
    // caption / hint elements above and below the stageWrap appear or
    // disappear), so we MUST re-measure the imageRect when they flip —
    // otherwise badges/TextLayer stay glued to the OLD stage and drift.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.hash, node?.image_w, node?.image_h, hasImage, isSvg, showChrome, fullscreen]);

  // Forward imageRect to the parent (so the floating click composer can
  // convert image-relative xy → stage-relative position itself).
  useEffect(() => {
    if (onImageRectChange) onImageRectChange(imageRect);
  }, [imageRect, onImageRectChange]);

  // Convert stage-relative xy (0..1 of stage box) → image-relative xy
  // (0..1 of painted image). Inverse of imageToStage.
  function stageToImage(xy: [number, number]): [number, number] {
    if (!imageRect || imageRect.width === 0 || imageRect.height === 0) {
      return [clamp01(xy[0]), clamp01(xy[1])];
    }
    const ix = (xy[0] * 100 - imageRect.left) / imageRect.width;
    const iy = (xy[1] * 100 - imageRect.top) / imageRect.height;
    return [clamp01(ix), clamp01(iy)];
  }
  // Convert image-relative xy → stage-relative xy (0..1 of stage box).
  function imageToStage(xy: [number, number]): [number, number] {
    if (!imageRect) return [clamp01(xy[0]), clamp01(xy[1])];
    const sx = (imageRect.left + xy[0] * imageRect.width) / 100;
    const sy = (imageRect.top + xy[1] * imageRect.height) / 100;
    return [clamp01(sx), clamp01(sy)];
  }

  // Hotspot anchor_xy / leader_xy are stored in image-relative space. We
  // transform them into stage-relative space (using imageRect) before
  // running the layout pass, so the cards and leader endpoints line up
  // with the painted picture even when it's letterboxed.
  const layouts = node && showLabels
    ? layOutHotspots(node.hotspots.map((h) => {
        const a: [number, number] = h.anchor_xy ?? [0, 0];
        const l: [number, number] = h.leader_xy ?? a;
        return { ...h, anchor_xy: imageToStage(a), leader_xy: imageToStage(l) };
      }))
    : [];

  // --- Leader-line geometry: measure card rects so the line lands on the
  // actual card edge instead of a guessed centre. We re-measure whenever
  // layouts (anchors) change, the node changes, or the window resizes.
  // Card rects in PERCENT of the stage (left, top, w, h). Index aligns with
  // layouts[*].idx. Empty until first measurement after mount.
  const [cardRects, setCardRects] = useState<Record<number, { l: number; t: number; w: number; h: number }>>({});

  useLayoutEffect(() => {
    if (!stageRef.current || layouts.length === 0) {
      if (Object.keys(cardRects).length) setCardRects({});
      return;
    }
    const measure = () => {
      const stageRect = stageRef.current?.getBoundingClientRect();
      if (!stageRect || stageRect.width === 0 || stageRect.height === 0) return;
      const next: Record<number, { l: number; t: number; w: number; h: number }> = {};
      for (const { idx } of layouts) {
        const btn = cardRefs.current[idx];
        if (!btn) continue;
        const r = btn.getBoundingClientRect();
        next[idx] = {
          l: ((r.left - stageRect.left) / stageRect.width) * 100,
          t: ((r.top - stageRect.top) / stageRect.height) * 56.25,
          w: (r.width / stageRect.width) * 100,
          h: (r.height / stageRect.height) * 56.25,
        };
      }
      setCardRects(next);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // Re-measure when the stage's vertical extent changes (chrome / fullscreen
    // toggles add or remove the title / caption / hint blocks above/below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.hash, layouts.length, JSON.stringify(layouts.map((l) => [l.idx, l.anchor[0], l.anchor[1]])), showChrome, fullscreen]);

  // Compute where the leader line should touch the card box: project the
  // leader endpoint onto the card edge nearest to it (so the line never
  // overlaps the card text and always lands on its border).
  function attachPoint(card: { l: number; t: number; w: number; h: number }, lx: number, ly: number) {
    const cx = card.l + card.w / 2;
    const cy = card.t + card.h / 2;
    const dx = lx - cx;
    const dy = ly - cy;
    if (dx === 0 && dy === 0) return [cx, cy] as const;
    // Find scale t such that |t*dx| <= w/2 and |t*dy| <= h/2 — i.e. the
    // line from card centre to (lx,ly) hits the card's bounding box edge.
    const tx = dx === 0 ? Infinity : (card.w / 2) / Math.abs(dx);
    const ty = dy === 0 ? Infinity : (card.h / 2) / Math.abs(dy);
    const t = Math.min(tx, ty);
    return [cx + dx * t, cy + dy * t] as const;
  }

  let stageClass = styles.stage;
  if (readOnly) stageClass += ` ${styles.stageReadOnly}`;
  else if (atCapacity) stageClass += ` ${styles.stageBusy}`;
  else if (hasImage && !imageLoading) stageClass += ` ${styles.stageClickable}`;
  // Scene-transition class — only applied for the first render of a new hash;
  // subsequent re-renders for the same node use enterMode='none' so SSE
  // updates don't replay the animation.
  if (enterMode === 'drill') stageClass += ` ${styles.enterDrill}`;
  else if (enterMode === 'up') stageClass += ` ${styles.enterUp}`;
  else if (enterMode === 'fade') stageClass += ` ${styles.enterFade}`;

  // transform-origin for drill animation — defaults to centre.
  const stageStyle: React.CSSProperties | undefined =
    enterMode === 'drill' && originXY
      ? { transformOrigin: `${(originXY[0] * 100).toFixed(2)}% ${(originXY[1] * 100).toFixed(2)}%` }
      : undefined;

  return (
    <>
      {showChrome && node && (
        <h2 className={styles.title}>
          {node.title}
          {node.sources && node.sources.length > 0 && <SourcesBadge sources={node.sources} />}
          {tree && onJumpToHash && (
            <TreeBadge tree={tree} currentHash={node.hash} onJump={onJumpToHash} />
          )}
        </h2>
      )}
      <div className={styles.stageWrap}>
      <div
        ref={stageRef}
        className={stageClass}
        style={stageStyle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
        role={interactive ? 'button' : undefined}
        aria-label={node && interactive ? `Press and hold anywhere on the image of ${node.title} to drill down` : undefined}
      >
        {hasImage && (
          isSvg
            ? <object className={styles.imageSvg} data={src} type="image/svg+xml" aria-label={node?.title ?? ''} />
            : <img ref={imgRef} className={styles.image} src={src} alt={node?.title ?? ''} draggable={false} />
        )}
        {(imageLoading || !hasImage) && <div className={styles.shimmer} aria-hidden />}

        {/* Leader lines: card edge to leader point */}
        {node && layouts.length > 0 && (
          <svg
            className={styles.leaderSvg}
            viewBox="0 0 100 56.25"
            preserveAspectRatio="none"
            aria-hidden
          >
            {layouts.map(({ idx, leader }) => {
              const tx = leader[0] * 100;
              const ty = leader[1] * 56.25;
              const card = cardRects[idx];
              // Until the card has been measured, fall back to a no-op (skip
              // drawing rather than draw to a wrong guessed point).
              if (!card) return null;
              const [sx, sy] = attachPoint(card, tx, ty);
              return (
                <g key={idx}>
                  <line x1={sx} y1={sy} x2={tx} y2={ty} />
                  <circle cx={tx} cy={ty} r="0.5" />
                </g>
              );
            })}
          </svg>
        )}

        {/* Selectable text overlay (OCR'd in-image annotations) */}
        {node && !isSvg && node.text_layer && node.text_layer.length > 0 && (
          <TextLayer
            spans={node.text_layer}
            rect={imageRect}
            stageHeightPx={stageHeightPx}
          />
        )}

        {/* Hotspot cards */}
        <div className={styles.hotspots}>
          {node && layouts.map(({ anchor, idx }) => (
            <HotspotCard
              key={idx}
              ref={(el) => { cardRefs.current[idx] = el; }}
              hotspot={node.hotspots[idx]}
              index={idx}
              anchor={anchor}
              onClick={onHotspotClick}
              onDelete={!readOnly ? onHotspotDelete : undefined}
            />
          ))}
        </div>

        {/* Long-press progress ring at the cursor while user is holding down.
             pressXY is image-relative; place it in stage space so the ring
             tracks the actual cursor even when the image is letterboxed. */}
        {pressXY && <LongPressIndicator xy={imageToStage(pressXY)} durationMs={LONG_PRESS_MS} />}

        {/* Custom overlay (e.g. floating click composer panel) — rendered
            above all canvas content so it's interactable. */}
        {overlay}

        {/* Pending click progress bubbles. clickXY is image-relative; convert
            to stage space for absolute positioning. */}
        {pendingClicks.map((p) => {
          const [sx, sy] = imageToStage(p.clickXY);
          // Prefer the server-streamed phase_message (specific to the
          // current step inside the pipeline — e.g. "Searching the web…"
          // / "Refining prompt…" / "Generating illustration…") over the
          // coarse PHASE_KEY chip. Fall back to messageEn when the i18n
          // entry isn't translated, then to the static phase chip.
          let phaseLabel = t(PHASE_KEY[p.phase], lang);
          if (p.messageKey) {
            const i18nKey = p.messageKey as Parameters<typeof t>[0];
            const localised = t(i18nKey, lang);
            // i18n.t returns the key string itself when missing — detect
            // that and fall through to messageEn.
            phaseLabel = localised && localised !== p.messageKey
              ? localised
              : (p.messageEn || phaseLabel);
          }
          return (
            <div
              key={p.jobId}
              className={styles.pendingClick}
              style={{
                left: pct(sx),
                top: pct(sy),
              }}
              title={phaseLabel}
            >
              <span className={styles.pendingDot} />
              <span className={styles.pendingLabel}>
                <span>{phaseLabel}</span>
              </span>
            </div>
          );
        })}

        {/* Capacity badge in top-right when 4/4 */}
        {atCapacity && !readOnly && (
          <div className={styles.capacityBadge}>
            {pendingClicks.length}/{MAX_PARALLEL_PER_NODE} · {t('canvas.busy.badge', lang)}
          </div>
        )}

        {/* Read-only badge — anchored to the actual painted image's top-right
            corner (not the stage's), so in fullscreen / pillar-boxed layouts
            it stays glued to the picture instead of floating in the empty
            letterbox strip. Falls back to stage corner pre-measure. Uses a
            lock icon to distinguish it from the eye-shaped chrome toggle.
            The fixed --readonly-offset (set in CSS) handles the inset on
            both desktop and small screens — only top/right are inlined. */}
        {readOnly && (
          <div
            className={styles.readOnlyBadge}
            style={imageRect ? {
              top: `${imageRect.top}%`,
              right: `${100 - (imageRect.left + imageRect.width)}%`,
              left: 'auto',
            } : undefined}
            title={t('canvas.preview.badge', lang)}
            aria-label={t('canvas.preview.badge', lang)}
          >
            <Icon name="lock" size={14} />
          </div>
        )}
      </div>
      </div>
      {showChrome && node?.caption && <p className={styles.caption}>{node.caption}</p>}
      {showChrome && !fullscreen && node && !readOnly && (
        <p className={styles.hint}>
          {atCapacity
            ? t('canvas.cap.full', lang)
            : t('canvas.hint.press', lang)}
        </p>
      )}
      {showChrome && !fullscreen && node && readOnly && (
        <p className={styles.hint}>
          {t('canvas.preview.hint', lang)}
        </p>
      )}
    </>
  );
}
