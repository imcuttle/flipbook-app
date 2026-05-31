import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';

type Props = {
  /** Raw caption text (may contain inline markdown). */
  text: string;
  /** Class applied to the wrapping <p> (caller owns caption layout styling). */
  className?: string;
};

// Node captions are a single line of prose that may contain INLINE markdown
// (**bold**, *italic*, `code`, ~~strike~~, [links](url)). We render with
// react-markdown but allow ONLY inline elements — block constructs (the
// wrapping paragraph, headings, lists, blockquotes) are unwrapped to their
// text so they can't break the single-line caption layout. react-markdown
// does not render raw HTML by default, so this is XSS-safe.
const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
};

// Inline marks we keep; everything else (incl. the wrapper <p>) is unwrapped.
const ALLOWED = ['a', 'em', 'strong', 'del', 'code', 'br'];

export function CaptionMarkdown({ text, className }: Props) {
  return (
    <p className={className}>
      <ReactMarkdown components={COMPONENTS} allowedElements={ALLOWED} unwrapDisallowed>
        {text}
      </ReactMarkdown>
    </p>
  );
}
