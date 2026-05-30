import test from 'node:test';
import assert from 'node:assert/strict';

async function loadLanguage() {
  try {
    return await import('../src/generation/language.js');
  } catch (e) {
    assert.fail(`language helper module missing: ${e.message}`);
  }
}

test('normalises unsupported language values to Chinese', async () => {
  const { normalizeLang } = await loadLanguage();
  assert.equal(normalizeLang('en'), 'en');
  assert.equal(normalizeLang('zh'), 'zh');
  assert.equal(normalizeLang('fr'), 'zh');
  assert.equal(normalizeLang(undefined), 'zh');
});

test('builds planner language instructions for all user-visible text', async () => {
  const { languageInstruction } = await loadLanguage();
  assert.match(languageInstruction('zh'), /标题/);
  assert.match(languageInstruction('zh'), /图片内/);
  assert.match(languageInstruction('zh'), /中文/);
  assert.match(languageInstruction('en'), /title/i);
  assert.match(languageInstruction('en'), /visible labels/i);
  assert.match(languageInstruction('en'), /English/);
});

test('builds image prompt instruction for visible annotations language', async () => {
  const { imageLanguageInstruction } = await loadLanguage();
  assert.match(imageLanguageInstruction('zh'), /图片中.*中文/s);
  assert.match(imageLanguageInstruction('en'), /visible.*English/i);
});
