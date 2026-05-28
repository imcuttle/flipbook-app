// SVG fallback provider — synthesises a placeholder SVG. Always enabled.
// Used as the final fallback in the provider chain so the pipeline never
// produces a missing image.
import path from 'node:path';
import { writeFallbackSvg } from '../../lib/svgFallback.js';

export default {
  name: 'svg',
  enabled() { return true; },
  async generate({ outputDir, title, hash }) {
    const file = path.join(outputDir, `${hash || 'fallback'}.svg`);
    await writeFallbackSvg(file, { title, hash });
    return { ok: true, path: file };
  },
};
