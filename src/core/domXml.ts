import type { XmlElement } from './xml';

/**
 * `XmlElement` over the browser's native DOMParser.
 *
 * Used in the app; `xmlParse.ts` covers Node and the test suite. Both are
 * exercised by the same parser code, so a discrepancy between them would show
 * up as a parse difference rather than silently.
 */
class DomElement implements XmlElement {
  constructor(private readonly el: globalThis.Element) {}

  get tag(): string {
    return this.el.tagName;
  }

  attr(name: string): string | null {
    return this.el.getAttribute(name);
  }

  children(tag?: string): XmlElement[] {
    const out: XmlElement[] = [];
    for (const c of Array.from(this.el.children)) {
      if (tag === undefined || c.tagName === tag) out.push(new DomElement(c));
    }
    return out;
  }

  child(tag: string): XmlElement | null {
    for (const c of Array.from(this.el.children)) {
      if (c.tagName === tag) return new DomElement(c);
    }
    return null;
  }

  text(): string {
    return this.el.textContent ?? '';
  }
}

export function parseXmlDom(source: string): XmlElement {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  const error = doc.querySelector('parsererror');
  if (error !== null) {
    throw new Error(`Could not read this file as XML: ${error.textContent?.trim() ?? 'malformed'}`);
  }
  const root = doc.documentElement;
  if (root === null) throw new Error('Could not read this file as XML: no root element');
  return new DomElement(root);
}
