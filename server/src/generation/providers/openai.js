// OpenAI Images provider stub.
// Wire up by setting OPENAI_API_KEY and either OPENAI_IMAGE_MODEL (default
// "gpt-image-1") or OPENAI_BASE_URL for self-hosted endpoints, then add
// 'openai' to IMAGE_PROVIDER (e.g. IMAGE_PROVIDER=openai,codebuddy,svg).
//
// Implementation skeleton — uncomment & flesh out when ready:
//   const r = await fetch(`${baseUrl}/v1/images/generations`, {
//     method: 'POST',
//     headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
//     body: JSON.stringify({ model, prompt: imagePrompt, size, response_format: 'b64_json' }),
//   });
//   const j = await r.json();
//   const buf = Buffer.from(j.data[0].b64_json, 'base64');
//   const file = path.join(outputDir, `openai-${Date.now()}.png`);
//   await fs.writeFile(file, buf);
//   return { ok: true, path: file };
//
// We register the provider in providers/index.js once it's implemented.
import { ImageGenError } from '../../lib/errors.js';

export default {
  name: 'openai',
  enabled(_config) {
    return !!process.env.OPENAI_API_KEY;
  },
  async generate(_args) {
    return { ok: false, reason: 'openai provider not implemented yet' };
  },
};
