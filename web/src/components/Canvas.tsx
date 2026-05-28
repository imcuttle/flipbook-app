import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from '../styles/Canvas.module.css';
import type { Node, PendingClick } from '../state/types';
import { HotspotCard } from './HotspotCard';
import { SourcesBadge } from './SourcesBadge';
import { LongPressIndicator } from './LongPressIndicator';
import { imageUrl } from '../lib/api';
import { clamp01, pct } from '../lib/geometry';
import { layOutHotspots } from '../lib/layout';

const MAX_PARALLEL_PER_NODE = 4;
const LONG_PRESS_MS = 2000;
const MOVE_CANCEL_PX = 10;

type Props = {
  canvasId: string;
  node: Node | null;
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
};

const PHASE_TEXT_EN: Record<PendingClick['phase'], string> = {
  planning: 'Inferring label…',
  image_loading: 'Generating image…',
  finalizing: 'Finalizing…',
};
const PHASE_TEXT_CN: Record<PendingClick['phase'], string> = {
  planning: '推断标签…',
  image_loading: '生成图片…',
  finalizing: '收尾中…',
};

export function Canvas({ canvasId, node, imageLoading, pendingClicks, readOnly, showChrome, showLabels, fullscreen, enterMode = 'none', originXY, onImageClick, onHotspotClick }: Props) {
  const hasImage = !!node?.image;
  const src = node?.image ? imageUrl(canvasId, node.image) : '';
  const isSvg = src.endsWith('.svg');
  const atCapacity = pendingClicks.length >= MAX_PARALLEL_PER_NODE;
  const interactive = !readOnly && hasImage && !imageLoading && !atCapacity;

  // Long-press tracking. Click became "press and hold for 2 s" — gives users
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
    const stage = e.currentTarget.getBoundingClientRect();
    const xRel = (e.clientX - stage.left) / stage.width;
    const yRel = (e.clientY - stage.top) / stage.height;
    const xy: [number, number] = [clamp01(xRel), clamp01(yRel)];
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

  const layouts = node && showLabels ? layOutHotspots(node.hotspots) : [];

  // --- Leader-line geometry: measure card rects so the line lands on the
  // actual card edge instead of a guessed centre. We re-measure whenever
  // layouts (anchors) change, the node changes, or the window resizes.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.hash, layouts.length, JSON.stringify(layouts.map((l) => [l.idx, l.anchor[0], l.anchor[1]]))]);

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
            : <img className={styles.image} src={src} alt={node?.title ?? ''} draggable={false} />
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
            />
          ))}
        </div>

        {/* Long-press progress ring at the cursor while user is holding down */}
        {pressXY && <LongPressIndicator xy={pressXY} durationMs={LONG_PRESS_MS} />}

        {/* Pending click progress bubbles */}
        {pendingClicks.map((p) => (
          <div
            key={p.jobId}
            className={styles.pendingClick}
            style={{
              left: pct(p.clickXY[0]),
              top: pct(p.clickXY[1]),
            }}
            title={PHASE_TEXT_EN[p.phase]}
          >
            <span className={styles.pendingDot} />
            <span className={styles.pendingLabel}>
              <span>{PHASE_TEXT_CN[p.phase]}</span>
              <span>{PHASE_TEXT_EN[p.phase]}</span>
            </span>
          </div>
        ))}

        {/* Capacity badge in top-right when 4/4 */}
        {atCapacity && !readOnly && (
          <div className={styles.capacityBadge}>
            {pendingClicks.length}/{MAX_PARALLEL_PER_NODE} 并行中 · please wait
          </div>
        )}

        {/* Read-only badge */}
        {readOnly && (
          <div className={styles.readOnlyBadge}>
            👁 Preview · 只读预览
          </div>
        )}
      </div>
      </div>
      {showChrome && node?.caption && <p className={styles.caption}>{node.caption}</p>}
      {showChrome && !fullscreen && node && !readOnly && (
        <p className={styles.hint}>
          {atCapacity
            ? 'Wait for one to finish · 4 个并行已满,等其中一个完成'
            : 'Press and hold any spot on the image (2 s) to expand · 长按图片任意位置 2 秒即可深入'}
        </p>
      )}
      {showChrome && !fullscreen && node && readOnly && (
        <p className={styles.hint}>
          Read-only preview — clicks disabled · 只读预览,无法触发新生成。生成中的进度仍会同步。
        </p>
      )}
    </>
  );
}
