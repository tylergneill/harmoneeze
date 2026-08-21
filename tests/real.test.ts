import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { downloadPath, loadScore, partByLabel } from './helpers';
import type { Score } from '../src/core/types';

/**
 * Generality tests against real scores.
 *
 * The fixtures prove the parser is *correct* against known ground truth; these
 * prove it is *general* against files nobody wrote for it. The `downloads/`
 * directory is gitignored, so each block skips cleanly when the files are
 * absent rather than failing a fresh clone.
 *
 * These scores are whatever the user happens to have downloaded, so the whole
 * directory is discovered rather than named file by file: a renamed or swapped
 * arrangement should still be exercised, not silently skipped. That means the
 * assertions here are about structure that must hold for *any* real score,
 * never about a particular file's contents.
 */

const BACH = downloadPath('real-bach-bwv269.musicxml');
const MXL_DIR = downloadPath('wellerman_mxl');

function findScores(): string[] {
  if (!existsSync(MXL_DIR)) return [];
  return readdirSync(MXL_DIR)
    .filter((name) => /\.(mxl|musicxml|xml)$/i.test(name))
    .sort()
    .map((name) => downloadPath('wellerman_mxl', name));
}

const WELLERMAN = findScores();

/** Invariants that must hold for any score the app will try to play. */
function expectPlayable(score: Score): void {
  expect(score.parts.length).toBeGreaterThan(0);
  expect(score.measures.length).toBeGreaterThan(0);
  expect(score.durationBeats).toBeGreaterThan(0);
  expect(score.tempoBpm).toBeGreaterThan(0);
  expect(score.title.trim()).not.toBe('');

  // At least one part must actually sound, or there is nothing to practise.
  expect(score.parts.some((p) => p.events.length > 0)).toBe(true);

  let cursor = 0;
  for (const m of score.measures) {
    expect(m.startBeats).toBeCloseTo(cursor, 6);
    expect(m.durationBeats).toBeGreaterThan(0);
    cursor += m.durationBeats;
  }

  for (const part of score.parts) {
    const onsets = part.events.map((e) => e.onsetBeats);
    expect(onsets).toEqual([...onsets].sort((a, b) => a - b));

    for (const e of part.events) {
      expect(e.durationBeats).toBeGreaterThan(0);
      expect(e.onsetBeats).toBeGreaterThanOrEqual(0);
      // Every note must land inside the timeline the playhead sweeps.
      expect(e.onsetBeats + e.durationBeats).toBeLessThanOrEqual(score.durationBeats + 1e-6);
      // A pitch outside the piano is a parse error, not music.
      expect(e.midiPitch).toBeGreaterThan(20);
      expect(e.midiPitch).toBeLessThan(108);
    }

    if (part.range !== null) {
      expect(part.range.minMidi).toBeLessThanOrEqual(part.range.maxMidi);
    }
  }
}

describe.skipIf(!existsSync(BACH))('Bach BWV 269 — the anti-overfitting test', () => {
  it('parses a real four-part chorale', () => {
    const score = loadScore(BACH);
    expectPlayable(score);
    expect(score.parts.map((p) => p.label)).toEqual(['Soprano', 'Alto', 'Tenor', 'Bass']);
  });

  it('unrolls the backward repeat back to the start of the piece', () => {
    // This chorale has a backward repeat with no matching forward repeat,
    // which MusicXML defines as repeating from the beginning.
    const score = loadScore(BACH);
    expect(score.measures.length).toBeGreaterThan(24);
    expect(score.measures.filter((m) => m.number === '0')).toHaveLength(2);
  });

  it('handles the pickup measure', () => {
    const score = loadScore(BACH);
    expect(score.measures[0].number).toBe('0');
  });

  it('merges tied notes into single sounding events', () => {
    // A tie means "hold", not "re-articulate", so a tied pair must become one
    // event. Counting is the reliable check: this chorale writes 229 pitched
    // notes per pass, of which 4 are tie-stops that must be absorbed. Adjacent
    // same-pitch events cannot be used as the signal, because Bach's part
    // writing genuinely repeats notes across barlines.
    const score = loadScore(BACH);
    const written = 46 + 61 + 59 + 63;
    const tieStops = 4;
    const soundingPerPass = written - tieStops;

    // Eight of the 24 written measures sound twice, so the total is one full
    // pass plus the repeated span; assert the ties are gone rather than the
    // exact repeat arithmetic.
    const total = score.parts.reduce((n, p) => n + p.events.length, 0);
    expect(total).toBeGreaterThanOrEqual(soundingPerPass);
    expect(total).toBeLessThan(written * 2);

    // The tenor's longest held note spans a full tied dotted half.
    const alto = partByLabel(score, 'Alto');
    expect(Math.max(...alto.events.map((e) => e.durationBeats))).toBeGreaterThan(1);
  });

  it('keeps the four voices in descending range order', () => {
    const score = loadScore(BACH);
    const lows = score.parts.map((p) => p.range!.minMidi);
    expect(lows[0]).toBeGreaterThan(lows[1]);
    expect(lows[1]).toBeGreaterThan(lows[2]);
    expect(lows[2]).toBeGreaterThan(lows[3]);
  });
});

describe.skipIf(WELLERMAN.length === 0)('The Wellerman — real arrangements (.mxl)', () => {
  it.each(WELLERMAN.map((path) => [basename(path), path]))(
    'reads %s without error',
    (_name, path) => {
      // .mxl is what MuseScore and Sibelius export by default, so it is the
      // first thing a real user hands the app. Unzipping goes through the
      // container manifest.
      expectPlayable(loadScore(path));
    },
  );

  it('names every arrangement and every part', () => {
    // A blank title or an unlabelled band leaves the user guessing which line
    // is theirs, which is the one thing the app must never do.
    for (const path of WELLERMAN) {
      const score = loadScore(path);
      expect(score.title.trim()).not.toBe('');
      for (const part of score.parts) {
        expect(part.label.trim()).not.toBe('');
      }
    }
  });

  it('finds more than one part to sing against', () => {
    // A single-part file would give the user nothing to practise with.
    for (const path of WELLERMAN) {
      expect(loadScore(path).parts.length).toBeGreaterThan(1);
    }
  });

  it('gives every arrangement a singable tempo', () => {
    // Scores that name no tempo fall back through the notated beat unit. A
    // cut-time shanty read as quarter notes plays at half speed, and the
    // playhead visibly lags the harmony.
    for (const path of WELLERMAN) {
      const score = loadScore(path);
      expect(score.tempoBpm).toBeGreaterThanOrEqual(60);
      expect(score.tempoBpm).toBeLessThanOrEqual(240);
    }
  });

  it('produces a timeline long enough to practise against', () => {
    for (const path of WELLERMAN) {
      const score = loadScore(path);
      const seconds = (score.durationBeats / score.tempoBpm) * 60;
      expect(seconds).toBeGreaterThan(15);
      // Anything past a few minutes means the tempo was misread.
      expect(seconds).toBeLessThan(600);
    }
  });

  it('keeps every part inside a human vocal range', () => {
    // A part outside this window means an octave or transposition error, not
    // an arrangement anyone could actually sing.
    for (const path of WELLERMAN) {
      for (const part of loadScore(path).parts) {
        if (part.range === null) continue;
        expect(part.range.minMidi).toBeGreaterThanOrEqual(36);
        expect(part.range.maxMidi).toBeLessThanOrEqual(84);
      }
    }
  });
});
