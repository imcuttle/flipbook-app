// Nano Banana (Google's image model) provider stub.
// Wire up by setting NANOBANANA_API_KEY (or routing through Google's GenAI SDK)
// and adding 'nanobanana' to IMAGE_PROVIDER.
export default {
  name: 'nanobanana',
  enabled() {
    return !!process.env.NANOBANANA_API_KEY || !!process.env.GEMINI_API_KEY;
  },
  async generate(_args) {
    return { ok: false, reason: 'nanobanana provider not implemented yet' };
  },
};
