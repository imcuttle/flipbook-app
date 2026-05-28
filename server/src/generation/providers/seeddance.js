// Seedream/Seedance (ByteDance) image provider stub.
// Wire up by setting SEEDDANCE_API_KEY (or ARK_API_KEY for the Volcengine Ark
// gateway) and adding 'seeddance' to IMAGE_PROVIDER.
export default {
  name: 'seeddance',
  enabled() {
    return !!process.env.SEEDDANCE_API_KEY || !!process.env.ARK_API_KEY;
  },
  async generate(_args) {
    return { ok: false, reason: 'seeddance provider not implemented yet' };
  },
};
