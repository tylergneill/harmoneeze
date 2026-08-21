import type { XmlElement } from './xml';

/**
 * A small, dependency-free XML reader producing `XmlElement` trees.
 *
 * This is deliberately not a general XML implementation. It handles exactly
 * what MusicXML files contain: elements, attributes, text, CDATA, comments,
 * the XML declaration, DOCTYPE, and the five predefined entities plus numeric
 * character references. Namespaces are not resolved (MusicXML does not use
 * them for its own vocabulary), and DTD-defined entities are not expanded.
 *
 * The browser build uses `domXml.ts` instead; this exists so the parser and
 * its tests can run under Node with no DOM.
 */

class Element implements XmlElement {
  readonly tag: string;
  private readonly attrs: Map<string, string>;
  private readonly kids: Element[] = [];
  private readonly textParts: string[] = [];

  constructor(tag: string, attrs: Map<string, string>) {
    this.tag = tag;
    this.attrs = attrs;
  }

  addChild(el: Element): void {
    this.kids.push(el);
  }

  addText(t: string): void {
    this.textParts.push(t);
  }

  attr(name: string): string | null {
    const v = this.attrs.get(name);
    return v === undefined ? null : v;
  }

  children(tag?: string): XmlElement[] {
    return tag === undefined ? [...this.kids] : this.kids.filter((k) => k.tag === tag);
  }

  child(tag: string): XmlElement | null {
    for (const k of this.kids) if (k.tag === tag) return k;
    return null;
  }

  /**
   * Own text plus all descendant text, in document order.
   *
   * MusicXML leaf values never mix text and elements, so for the elements
   * this parser actually reads this is just the leaf's own text.
   */
  text(): string {
    if (this.kids.length === 0) return this.textParts.join('');
    const out: string[] = [...this.textParts];
    for (const k of this.kids) out.push(k.text());
    return out.join('');
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    const named = ENTITIES[body];
    return named === undefined ? whole : named;
  });
}

const NAME_CHAR = /[A-Za-z0-9_.:-]/;

/** Parse an XML document and return its root element. */
export function parseXml(source: string): XmlElement {
  let i = 0;
  const n = source.length;
  const stack: Element[] = [];
  let root: Element | null = null;

  const fail = (msg: string): never => {
    const line = source.slice(0, i).split('\n').length;
    throw new Error(`XML parse error at line ${line}: ${msg}`);
  };

  const readName = (): string => {
    const start = i;
    while (i < n && NAME_CHAR.test(source[i])) i++;
    if (i === start) fail('expected a name');
    return source.slice(start, i);
  };

  const skipSpace = (): void => {
    while (i < n && (source[i] === ' ' || source[i] === '\t' || source[i] === '\n' || source[i] === '\r')) i++;
  };

  /** Skip a construct that ends with the given terminator. */
  const skipUntil = (term: string): void => {
    const at = source.indexOf(term, i);
    i = at === -1 ? n : at + term.length;
  };

  /**
   * Skip a DOCTYPE declaration, including any internal subset in [ ... ].
   * Bracket nesting is not permitted inside an internal subset, so tracking
   * the single pair is sufficient.
   */
  const skipDoctype = (): void => {
    let inSubset = false;
    while (i < n) {
      const c = source[i];
      if (c === '[') inSubset = true;
      else if (c === ']') inSubset = false;
      else if (c === '>' && !inSubset) {
        i++;
        return;
      }
      i++;
    }
  };

  while (i < n) {
    if (source[i] !== '<') {
      // Character data. Only meaningful inside an element.
      const next = source.indexOf('<', i);
      const end = next === -1 ? n : next;
      if (stack.length > 0) {
        const raw = source.slice(i, end);
        if (raw.length > 0) stack[stack.length - 1].addText(decodeEntities(raw));
      }
      i = end;
      continue;
    }

    if (source.startsWith('<!--', i)) {
      i += 4;
      skipUntil('-->');
      continue;
    }
    if (source.startsWith('<?', i)) {
      i += 2;
      skipUntil('?>');
      continue;
    }
    if (source.startsWith('<![CDATA[', i)) {
      i += 9;
      const end = source.indexOf(']]>', i);
      const stop = end === -1 ? n : end;
      if (stack.length > 0) stack[stack.length - 1].addText(source.slice(i, stop));
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (source.startsWith('<!DOCTYPE', i)) {
      i += 9;
      skipDoctype();
      continue;
    }

    if (source.startsWith('</', i)) {
      i += 2;
      const name = readName();
      skipSpace();
      if (source[i] !== '>') fail(`expected '>' closing </${name}`);
      i++;
      const open = stack.pop();
      if (open === undefined) fail(`unexpected closing tag </${name}>`);
      else if (open.tag !== name) fail(`</${name}> closes <${open.tag}>`);
      continue;
    }

    // Opening tag.
    i++;
    const name = readName();
    const attrs = new Map<string, string>();
    for (;;) {
      skipSpace();
      if (i >= n) fail(`unterminated <${name}`);
      if (source[i] === '>' || source.startsWith('/>', i)) break;
      const attrName = readName();
      skipSpace();
      if (source[i] !== '=') fail(`expected '=' after attribute ${attrName}`);
      i++;
      skipSpace();
      const quote = source[i];
      if (quote !== '"' && quote !== "'") fail(`expected a quoted value for ${attrName}`);
      i++;
      const end = source.indexOf(quote, i);
      if (end === -1) fail(`unterminated value for ${attrName}`);
      attrs.set(attrName, decodeEntities(source.slice(i, end)));
      i = end + 1;
    }

    const selfClosing = source.startsWith('/>', i);
    i += selfClosing ? 2 : 1;

    const el = new Element(name, attrs);
    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent.addChild(el);
    else if (root === null) root = el;
    else fail(`second root element <${name}>`);

    if (!selfClosing) stack.push(el);
  }

  if (stack.length > 0) throw new Error(`XML parse error: <${stack[stack.length - 1].tag}> was never closed`);
  if (root === null) throw new Error('XML parse error: document has no root element');
  return root;
}
