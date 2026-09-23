import React from 'react';

/**
 * A deliberately small Markdown renderer for curation READMEs and notes.
 *
 * Scope, not laziness: curation prose needs paragraphs, bullet lists, bold,
 * italic, inline code and links, and that is the whole of it. Supporting tables,
 * nested lists, images and embedded HTML would add a dependency and a parser far
 * larger than the text it renders.
 *
 * Everything here produces React elements. Nothing is ever handed to
 * dangerouslySetInnerHTML, so there is no HTML to sanitise and no way for
 * anything in a README — which is published to the public tracker — to become
 * markup. Link hrefs are additionally restricted to http and https, so a
 * `javascript:` URL renders as plain text rather than as a link.
 *
 * Unsupported syntax degrades to its literal characters. A curator who writes a
 * table sees the pipes, which is wrong-looking but never broken or unsafe.
 */

/** Inline spans, applied in order. Each captures exactly one construct. */
const INLINE = [
  { re: /`([^`]+)`/, render: (m: RegExpMatchArray, key: number) => (
      <code key={key} className="font-mono text-[0.9em] bg-gray-100 text-gray-800 px-1 py-px rounded">
        {m[1]}
      </code>
    ) },
  { re: /\*\*([^*]+)\*\*/, render: (m: RegExpMatchArray, key: number) => (
      <strong key={key} className="font-semibold">{m[1]}</strong>
    ) },
  { re: /\*([^*]+)\*/, render: (m: RegExpMatchArray, key: number) => (
      <em key={key}>{m[1]}</em>
    ) },
  { re: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/, render: (m: RegExpMatchArray, key: number) => (
      <a key={key} href={m[2]} target="_blank" rel="noopener noreferrer"
         className="text-blue-600 underline hover:text-blue-800 break-words">{m[1]}</a>
    ) },
  // Bare URLs, so a pasted accession link is clickable without markup.
  { re: /(https?:\/\/[^\s<>()]+)/, render: (m: RegExpMatchArray, key: number) => (
      <a key={key} href={m[1]} target="_blank" rel="noopener noreferrer"
         className="text-blue-600 underline hover:text-blue-800 break-words">{m[1]}</a>
    ) },
];

/**
 * Resolve inline syntax within one line of text.
 *
 * Finds the earliest match of any construct, emits the text before it and the
 * element for it, then continues on the remainder — so constructs cannot nest
 * and cannot overlap, which is what keeps this small and predictable.
 */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let rest = text;
  let key = 0;

  while (rest) {
    let best: { index: number; match: RegExpMatchArray; render: typeof INLINE[number]['render'] } | null = null;

    for (const rule of INLINE) {
      const match = rest.match(rule.re);
      if (match && match.index !== undefined && (!best || match.index < best.index)) {
        best = { index: match.index, match, render: rule.render };
      }
    }

    if (!best) {
      out.push(rest);
      break;
    }

    if (best.index > 0) out.push(rest.slice(0, best.index));
    out.push(best.render(best.match, key++));
    rest = rest.slice(best.index + best.match[0].length);
  }

  return out.map((node, i) =>
    typeof node === 'string' ? <React.Fragment key={`${keyPrefix}-t${i}`}>{node}</React.Fragment> : node,
  );
}

/**
 * Render curation prose.
 *
 * Blank lines separate paragraphs; lines starting `- ` or `* ` become list
 * items. A run of adjacent list items becomes one list.
 */
export const Markdown: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  if (!text?.trim()) return null;

  const blocks: React.ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const key = `p${blocks.length}`;
    blocks.push(<p key={key}>{renderInline(paragraph.join(' '), key)}</p>);
    paragraph = [];
  };

  const flushBullets = () => {
    if (!bullets.length) return;
    const key = `u${blocks.length}`;
    blocks.push(
      <ul key={key} className="list-disc pl-5 space-y-1">
        {bullets.map((item, i) => <li key={i}>{renderInline(item, `${key}-${i}`)}</li>)}
      </ul>,
    );
    bullets = [];
  };

  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      bullets.push(bullet[1]);
    } else if (!line.trim()) {
      flushParagraph();
      flushBullets();
    } else {
      flushBullets();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushBullets();

  return <div className={className ? `${className} space-y-2` : 'space-y-2'}>{blocks}</div>;
};

export default Markdown;
