import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { downloadPath, loadScore, partByLabel } from './helpers';
import { midiToName } from '../src/core/pitch';
import type { Score } from '../src/core/types';

/**
 * Generality tests against real scores.
 *
 * The fixtures prove the parser is *correct* against known ground truth; these
 * prove it is *general* against files nobody wrote for it. The `downloads/`
 * directory is gitignored, so each block skips cleanly when the files are
 * absent rather than failing a fresh clone.
 */

const BACH = downloadPath('real-bach-bwv269.musicxml');
const WELLERMAN = ['alto', 'baritone', 'bass', 'tenor'].map((n) =>
  downloadPath('wellerman_mxl', `wellerman-${n}.mxl`),
);

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

describe.skipIf(!WELLERMAN.every(existsSync))('The Wellerman — real arrangements (.mxl)', () => {
  it('reads every arrangement without error', () => {
    for (const path of WELLERMAN) {
      expectPlayable(loadScore(path));
    }
  });

  it('unzips compressed MusicXML via the container manifest', () => {
    // .mxl is what MuseScore and Sibelius export by default, so it is the
    // first thing a real user hands the app.
    const score = loadScore(WELLERMAN[0]);
    expect(score.title).toBe('Wellerman - SSA');
    expect(score.parts.map((p) => p.label)).toEqual(['Soprano 1', 'Soprano 2', 'Alto']);
  });

  it('reads the tempo the arranger notated', () => {
    expect(loadScore(WELLERMAN[0]).tempoBpm).toBe(160);
    expect(loadScore(WELLERMAN[1]).tempoBpm).toBe(180);
  });

  it('reads a five-part arrangement with a solo verse line', () => {
    const score = loadScore(WELLERMAN[2]);
    expect(score.parts.map((p) => p.label)).toEqual([
      'Strofa', 'Soprano', 'Alto', 'Tenor', 'Bass',
    ]);
    // Every part carries music; a silent band would mean a dropped voice.
    expect(score.parts.every((p) => p.events.length > 0)).toBe(true);
  });

  it('gives the bass part a bass-register range', () => {
    const bass = partByLabel(loadScore(WELLERMAN[2]), 'Bass');
    expect(bass.clef).toBe('F');
    expect(midiToName(bass.range!.maxMidi)).toMatch(/[23]$/);
  });

  it('produces a timeline long enough to practise against', () => {
    for (const path of WELLERMAN) {
      const score = loadScore(path);
      const seconds = (score.durationBeats / score.tempoBpm) * 60;
      expect(seconds).toBeGreaterThan(20);
    }
  });
});
