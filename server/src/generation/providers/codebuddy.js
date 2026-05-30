// Codebuddy CLI provider — wraps the existing codebuddyClient.callImageGen.
import { callImageGen } from '../../codebuddyClient.js';

export default {
  name: 'codebuddy',
  enabled(config) {
    return !!config.enableCodebuddy;
  },
  async generate({ imagePrompt, outputDir, size, seedImagePath, onEvent }) {
    // callImageGen already returns { ok, path?, reason?, refusalProse? };
    // pass it through unchanged so the orchestrator (image.js) can run a
    // prompt-repair pass against the prose.
    return callImageGen({ imagePrompt, outputDir, size, seedImagePath, onEvent });
  },
};
