/**
 * A minimal read-only XML element interface.
 *
 * The parser needs to run in two places: the browser (where DOMParser exists)
 * and Node, under vitest (where it does not). Rather than pull a DOM shim into
 * the app bundle, the parser is written against this tiny interface and the
 * two environments each supply an implementation.
 */
export interface XmlElement {
  readonly tag: string;
  attr(name: string): string | null;
  /** Direct children with the given tag. */
  children(tag?: string): XmlElement[];
  /** First direct child with the given tag, or null. */
  child(tag: string): XmlElement | null;
  /** Concatenated text content of this element. */
  text(): string;
}

/** Text of a named direct child, or null when the child is absent. */
export function childText(el: XmlElement, tag: string): string | null {
  const c = el.child(tag);
  return c === null ? null : c.text();
}

/** Numeric text of a named direct child, or `fallback` if absent/unparseable. */
export function childNumber(el: XmlElement, tag: string, fallback: number): number {
  const t = childText(el, tag);
  if (t === null) return fallback;
  const n = Number(t.trim());
  return Number.isFinite(n) ? n : fallback;
}

/** True when a direct child with this tag exists (for empty flag elements). */
export function hasChild(el: XmlElement, tag: string): boolean {
  return el.child(tag) !== null;
}
