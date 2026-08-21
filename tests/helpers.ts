import { readFileSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseXml } from '../src/core/xmlParse';
import { parseScoreFile } from '../src/core/ingest';
import type { Score } from '../src/core/types';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function fixturePath(name: string): string {
  return resolve(ROOT, 'fixtures', name);
}

export function downloadPath(...parts: string[]): string {
  return resolve(ROOT, 'downloads', ...parts);
}

/** Read a file as an ArrayBuffer, the shape the browser hands the app. */
export function readAsArrayBuffer(path: string): ArrayBuffer {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Parse a score file from disk exactly as an upload would be parsed. */
export function loadScore(path: string): Score {
  return parseScoreFile(basename(path), readAsArrayBuffer(path), parseXml);
}

/** Look up a part by label, failing loudly when it is missing. */
export function partByLabel(score: Score, label: string) {
  const part = score.parts.find((p) => p.label === label);
  if (part === undefined) {
    throw new Error(`No part "${label}"; found: ${score.parts.map((p) => p.label).join(', ')}`);
  }
  return part;
}
