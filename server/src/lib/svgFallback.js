// SVG placeholder image generator — used when ImageGen is disabled or fails.
// Mimics the style suffix's beige/isometric palette without drawing real text "labels"
// (the title is shown as overlay UI; here we draw a watermark for development clarity).
import fs from 'node:fs/promises';
import path from 'node:path';

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildFallbackSvg({ title = 'Flipbook node', hash = '' } = {}) {
  const t = escapeXml(title.slice(0, 60));
  const h = escapeXml(hash);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
  <defs>
    <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
      <path d="M80 0H0V80" fill="none" stroke="rgba(0,0,0,0.04)" stroke-width="1"/>
    </pattern>
    <linearGradient id="iso" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F5EFE6"/>
      <stop offset="100%" stop-color="#ECE2D2"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#iso)"/>
  <rect width="1920" height="1080" fill="url(#grid)"/>
  <g transform="translate(960,540)" opacity="0.18" font-family="Georgia, serif" text-anchor="middle">
    <text font-size="64" fill="#1F1F1F">${t}</text>
    <text y="60" font-size="22" fill="#6F6457">placeholder · ${h}</text>
  </g>
  <g stroke="#1F1F1F" stroke-width="1" fill="none" opacity="0.25">
    <polygon points="320,360 720,200 1120,360 720,520"/>
    <polygon points="800,640 1280,460 1680,640 1200,820"/>
    <polygon points="200,720 520,580 880,760 560,900"/>
  </g>
</svg>`;
}

export async function writeFallbackSvg(filePath, opts = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buildFallbackSvg(opts), 'utf8');
  return filePath;
}
