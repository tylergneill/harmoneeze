import { describe, it, expect } from 'vitest';
import { fixturePath, loadScore, partByLabel } from './helpers';
import { pitchToMidi, midiToName } from '../src/core/pitch';

/**
 * Fixture tests (design_docs/README.md).
 *
 * The fixtures are synthetic and their ground truth is known, so these
 * assertions are exact. `real.test.ts` covers generality on real scores.
 */

const SIMPLE = fixturePath('wellerman-fixture-simple.musicxml');
const SHARED = fixturePath('wellerman-fixture-shared-staff.musicxml');

describe('repeat unrolling', () => {
  it('unrolls 16 written measures to 22 played measures', () => {
    // The single most useful assertion in the project: if this reports 16, the
    // playhead will drift out of sync with the bands.
    expect(loadScore(SIMPLE).measures).toHaveLength(22);
  });

  it('plays measures in the order 1-7, 1-6, 8-16', () => {
    const numbers = loadScore(SIMPLE).measures.map((m) => m.number);
    expect(numbers).toEqual([
      '1', '2', '3', '4', '5', '6', '7',
      '1', '2', '3', '4', '5', '6',
      '8', '9', '10', '11', '12', '13', '14', '15', '16',
    ]);
  });

  it('takes the first ending only on the first pass', () => {
    const measures = loadScore(SIMPLE).measures;
    expect(measures.filter((m) => m.number === '7')).toHaveLength(1);
    expect(measures.filter((m) => m.number === '8')).toHaveLength(1);
  });

  it('marks the repeated measures as a second pass', () => {
    const measures = loadScore(SIMPLE).measures;
    const firstPass = measures.filter((m) => m.number === '1');
    expect(firstPass.map((m) => m.pass)).toEqual([0, 1]);
  });

  it('lays measures end to end with no gaps or overlaps', () => {
    const { measures, durationBeats } = loadScore(SIMPLE);
    let cursor = 0;
    for (const m of measures) {
      expect(m.startBeats).toBeCloseTo(cursor, 9);
      expect(m.durationBeats).toBeGreaterThan(0);
      cursor += m.durationBeats;
    }
    expect(durationBeats).toBeCloseTo(cursor, 9);
    // 22 measures of 4/4.
    expect(durationBeats).toBeCloseTo(88, 9);
  });

  it('gives every measure a unique, monotonic index', () => {
    const measures = loadScore(SIMPLE).measures;
    expect(measures.map((m) => m.index)).toEqual(measures.map((_, i) => i));
  });
});

describe('part extraction', () => {
  it('reads four parts from the four-staff fixture', () => {
    expect(loadScore(SIMPLE).parts.map((p) => p.label)).toEqual([
      'Soprano', 'Alto', 'Tenor', 'Bass',
    ]);
  });

  it('reads four parts from the shared-staff fixture, not two', () => {
    // The §5.2 multi-voice case: a naive parser reports two parts here.
    const score = loadScore(SHARED);
    expect(score.parts).toHaveLength(4);
    expect(score.parts.map((p) => p.label)).toEqual([
      'Women 1', 'Women 2', 'Men 1', 'Men 2',
    ]);
  });

  it('splits shared staves by voice, not by staff', () => {
    const score = loadScore(SHARED);
    expect(score.parts.map((p) => p.source)).toEqual([
      { partId: 'P1', voice: '1' },
      { partId: 'P1', voice: '2' },
      { partId: 'P2', voice: '1' },
      { partId: 'P2', voice: '2' },
    ]);
  });

  it('warns the user that a staff was split', () => {
    expect(loadScore(SHARED).warnings.join(' ')).toMatch(/2 voices on one staff/);
  });

  it('derives the same music from both fixture layouts', () => {
    // Same music, two engravings: the parser must be blind to the difference.
    const simple = loadScore(SIMPLE);
    const shared = loadScore(SHARED);
    expect(shared.measures).toHaveLength(simple.measures.length);

    for (const [i, part] of simple.parts.entries()) {
      expect(shared.parts[i].events).toEqual(part.events);
    }
  });

  it('records the clef each part was engraved on', () => {
    const score = loadScore(SIMPLE);
    expect(partByLabel(score, 'Soprano').clef).toBe('G');
    expect(partByLabel(score, 'Bass').clef).toBe('F');
  });

  it('reads the key signature', () => {
    // One flat, D minor.
    expect(loadScore(SIMPLE).parts.every((p) => p.keyFifths === -1)).toBe(true);
  });
});

describe('sparse parts', () => {
  it('keeps a part that rests through the verse, with no notes there', () => {
    // A/T/B rest through mm. 1-8 — the shanty's solo leader texture.
    const score = loadScore(SIMPLE);
    const bass = partByLabel(score, 'Bass');
    expect(bass.events.length).toBeGreaterThan(0);

    // The verse occupies the first 13 unrolled measures (mm. 1-7, 1-6).
    const chorusStart = score.measures[13].startBeats;
    expect(bass.events.every((e) => e.onsetBeats >= chorusStart)).toBe(true);
  });

  it('still reports a duration covering the whole piece for silent stretches', () => {
    const score = loadScore(SIMPLE);
    expect(score.durationBeats).toBeCloseTo(88, 9);
  });
});

describe('pitch', () => {
  it('places middle C at MIDI 60', () => {
    expect(pitchToMidi('C', 4, 0)).toBe(60);
    expect(midiToName(60)).toBe('C4');
  });

  it('applies accidentals', () => {
    expect(pitchToMidi('B', 4, -1)).toBe(70);
    expect(pitchToMidi('C', 5, 1)).toBe(73);
  });

  it('reads the C sharp in the m14 dominant against a one-flat key', () => {
    // The fixture's accidental-against-key case.
    const score = loadScore(SIMPLE);
    const inM14 = score.parts
      .flatMap((p) => p.events)
      .filter((e) => e.measureNumber === '14')
      .map((e) => e.midiPitch % 12);
    // Pitch class 1 is C#.
    expect(inM14).toContain(1);
  });

  it('gives every part a range covering its own notes', () => {
    for (const part of loadScore(SIMPLE).parts) {
      const pitches = part.events.map((e) => e.midiPitch);
      expect(part.range).not.toBeNull();
      expect(part.range!.minMidi).toBe(Math.min(...pitches));
      expect(part.range!.maxMidi).toBe(Math.max(...pitches));
    }
  });
});

describe('note events', () => {
  it('reads the soprano pickup phrase of measure 1', () => {
    const soprano = partByLabel(loadScore(SIMPLE), 'Soprano');
    const first = soprano.events.slice(0, 4);
    expect(first.map((e) => midiToName(e.midiPitch))).toEqual(['D4', 'F4', 'A4', 'A4']);
    expect(first.map((e) => e.onsetBeats)).toEqual([0, 1, 2, 3]);
    expect(first.map((e) => e.durationBeats)).toEqual([1, 1, 1, 1]);
  });

  it('sorts events by onset', () => {
    for (const part of loadScore(SIMPLE).parts) {
      const onsets = part.events.map((e) => e.onsetBeats);
      expect(onsets).toEqual([...onsets].sort((a, b) => a - b));
    }
  });

  it('gives every note a positive duration', () => {
    for (const part of loadScore(SIMPLE).parts) {
      expect(part.events.every((e) => e.durationBeats > 0)).toBe(true);
    }
  });

  it('keeps every note inside the timeline', () => {
    const score = loadScore(SIMPLE);
    for (const part of score.parts) {
      for (const e of part.events) {
        expect(e.onsetBeats).toBeGreaterThanOrEqual(0);
        expect(e.onsetBeats + e.durationBeats).toBeLessThanOrEqual(score.durationBeats + 1e-9);
      }
    }
  });

  it('repeats the verse music note for note on the second pass', () => {
    // Unrolling must duplicate the music, not merely the measure slots.
    const score = loadScore(SIMPLE);
    const soprano = partByLabel(score, 'Soprano');
    const firstPass = soprano.events.filter((e) => e.onsetBeats < 24);
    const secondPass = soprano.events.filter(
      (e) => e.onsetBeats >= 28 && e.onsetBeats < 52,
    );
    expect(secondPass.map((e) => e.midiPitch)).toEqual(firstPass.map((e) => e.midiPitch));
  });
});
