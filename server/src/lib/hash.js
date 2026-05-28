// Port of skill/scripts/hash.mjs.
// sha256(parent + "\n" + label + "\n" + image_prompt).slice(0,12)
import { createHash } from 'node:crypto';

export function hashNode(parentHash, label, imagePrompt) {
  return createHash('sha256')
    .update(`${parentHash ?? ''}\n${label ?? ''}\n${imagePrompt ?? ''}`, 'utf8')
    .digest('hex')
    .slice(0, 12);
}

export function rootHash(topic, imagePrompt) {
  return hashNode('', topic, imagePrompt);
}
