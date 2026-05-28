// Port of skill/scripts/init.mjs slugify.
export function slugify(s) {
  if (!s) return 'untitled';
  return (
    String(s)
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'untitled'
  );
}
