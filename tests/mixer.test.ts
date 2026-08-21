import { describe, it, expect } from 'vitest';
import {
  applyVolumeChange,
  initialMixState,
  resetVolumes,
  setFocusPart,
  setLinkMode,
  soloFocus,
  volumeToGain,
  DEFAULT_VOLUME,
} from '../src/core/mixer';
import {
  beatsToSeconds,
  effectiveLoop,
  formatTime,
  measureAtBeat,
  normalizeLoopRegion,
  secondsToBeats,
  snapToMeasure,
  bandPitchRange,
  eventsAtBeat,
} from '../src/core/timeline';
import { fixturePath, loadScore, partByLabel } from './helpers';

const score = loadScore(fixturePath('wellerman-fixture-simple.musicxml'));
const ids = score.parts.map((p) => p.id);
const [S, A, T, B] = ids;

describe('mixer link modes', () => {
  it('starts every part audible', () => {
    const state = initialMixState(score);
    expect(Object.values(state.volumes)).toEqual(ids.map(() => DEFAULT_VOLUME));
  });

  it('claims no part until the user picks one', () => {
    // Defaulting to the first part would silently make the soprano "theirs"
    // and quietly change what the link modes act on.
    expect(initialMixState(score).focusPartId).toBeNull();
  });

  it('leaves every fader alone in "all except focus" with no focus set', () => {
    const base = setLinkMode(initialMixState(score), 'all-except-focus');
    const state = applyVolumeChange(base, S, 20, ids);
    // With no referent the mode still must not corrupt the mix: the grabbed
    // fader moves and, having nothing to exempt, the rest follow it.
    expect(state.volumes[S]).toBe(20);
    expect(state.volumes[A]).toBe(20);
  });

  it('moves one fader alone in independent mode', () => {
    const state = applyVolumeChange(initialMixState(score), A, 20, ids);
    expect(state.volumes[A]).toBe(20);
    expect(state.volumes[S]).toBe(DEFAULT_VOLUME);
    expect(state.volumes[B]).toBe(DEFAULT_VOLUME);
  });

  it('moves every fader together in "all" mode', () => {
    const base = setLinkMode(initialMixState(score), 'all');
    const state = applyVolumeChange(base, A, DEFAULT_VOLUME - 30, ids);
    for (const id of ids) expect(state.volumes[id]).toBe(DEFAULT_VOLUME - 30);
  });

  it('preserves relative balance when linked faders move', () => {
    let state = applyVolumeChange(initialMixState(score), A, 40, ids);
    state = setLinkMode(state, 'all');
    state = applyVolumeChange(state, S, DEFAULT_VOLUME - 10, ids);
    // Everyone dropped by 10; the alto's 40-point offset survives.
    expect(state.volumes[S]).toBe(DEFAULT_VOLUME - 10);
    expect(state.volumes[A]).toBe(30);
  });

  it('holds the focus part still in "all except focus" mode', () => {
    // The doc's most-used gesture: turn everyone else down, leave my line be.
    let state = setLinkMode(initialMixState(score), 'all-except-focus');
    state = setFocusPart(state, B);
    state = applyVolumeChange(state, S, DEFAULT_VOLUME - 50, ids);

    expect(state.volumes[B]).toBe(DEFAULT_VOLUME);
    expect(state.volumes[S]).toBe(DEFAULT_VOLUME - 50);
    expect(state.volumes[A]).toBe(DEFAULT_VOLUME - 50);
    expect(state.volumes[T]).toBe(DEFAULT_VOLUME - 50);
  });

  it('still moves the focus fader when the user grabs it directly', () => {
    let state = setLinkMode(initialMixState(score), 'all-except-focus');
    state = setFocusPart(state, B);
    state = applyVolumeChange(state, B, 100, ids);
    expect(state.volumes[B]).toBe(100);
    // The others follow, since the focus exemption is about being dragged past.
    expect(state.volumes[S]).toBe(100);
  });

  it('clamps to 0..100 without dragging the moved fader off target', () => {
    const base = setLinkMode(initialMixState(score), 'all');
    const state = applyVolumeChange(base, A, 100, ids);
    for (const id of ids) expect(state.volumes[id]).toBe(100);

    const down = applyVolumeChange(state, A, 0, ids);
    for (const id of ids) expect(down.volumes[id]).toBe(0);
  });

  it('lets a part be silenced completely', () => {
    const state = applyVolumeChange(initialMixState(score), T, 0, ids);
    expect(state.volumes[T]).toBe(0);
    expect(volumeToGain(state.volumes[T])).toBe(0);
  });

  it('solos the focus part in one gesture', () => {
    let state = setFocusPart(initialMixState(score), T);
    state = soloFocus(state, ids);
    expect(state.volumes[T]).toBe(100);
    expect(state.volumes[S]).toBe(0);
    expect(state.volumes[A]).toBe(0);
    expect(state.volumes[B]).toBe(0);
  });

  it('resets every fader', () => {
    let state = applyVolumeChange(initialMixState(score), S, 3, ids);
    state = resetVolumes(state, ids);
    for (const id of ids) expect(state.volumes[id]).toBe(DEFAULT_VOLUME);
  });

  it('maps faders to gain monotonically, with silence at zero', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(100)).toBe(1);
    expect(volumeToGain(50)).toBeLessThan(0.5);
    expect(volumeToGain(70)).toBeGreaterThan(volumeToGain(30));
  });
});

describe('loop regions', () => {
  it('loops the whole song when no region is set', () => {
    expect(effectiveLoop(score, null)).toEqual({ startBeats: 0, endBeats: score.durationBeats });
  });

  it('normalises a backwards drag', () => {
    expect(normalizeLoopRegion(score, 40, 8)).toEqual({ startBeats: 8, endBeats: 40 });
  });

  it('clamps a drag to the bounds of the piece', () => {
    const region = normalizeLoopRegion(score, -20, score.durationBeats + 50);
    expect(region).toEqual({ startBeats: 0, endBeats: score.durationBeats });
  });

  it('treats a click as clearing the region', () => {
    expect(normalizeLoopRegion(score, 12, 12)).toBeNull();
    expect(normalizeLoopRegion(score, 12, 12.1)).toBeNull();
  });

  it('snaps a rough drag to measure lines', () => {
    // The chorus starts at unrolled measure 14 (written m8).
    const chorus = score.measures[13];
    expect(snapToMeasure(score, chorus.startBeats + 0.7)).toBe(chorus.startBeats);
    expect(snapToMeasure(score, 0.3)).toBe(0);
  });

  it('can snap to the very end of the piece', () => {
    expect(snapToMeasure(score, score.durationBeats - 0.2)).toBe(score.durationBeats);
  });

  it('selects the chorus as a loop region', () => {
    // The doc's acceptance test: loop the chorus and sing the bass line.
    const chorusStart = score.measures[13].startBeats;
    const region = normalizeLoopRegion(score, chorusStart, score.durationBeats);
    expect(region).not.toBeNull();
    expect(region!.startBeats).toBe(chorusStart);

    const bass = partByLabel(score, 'Bass');
    const inLoop = bass.events.filter(
      (e) => e.onsetBeats >= region!.startBeats && e.onsetBeats < region!.endBeats,
    );
    // The bass sings the whole chorus, so looping it gives something to learn.
    expect(inLoop).toHaveLength(bass.events.length);
  });
});

describe('timeline helpers', () => {
  it('converts beats to seconds and back', () => {
    expect(beatsToSeconds(4, 120)).toBe(2);
    expect(secondsToBeats(2, 120)).toBe(4);
  });

  it('finds the measure at a beat position', () => {
    expect(measureAtBeat(score, 0)!.number).toBe('1');
    expect(measureAtBeat(score, 4)!.number).toBe('2');
    expect(measureAtBeat(score, score.durationBeats)).toBeNull();
  });

  it('distinguishes the two passes of a repeated measure', () => {
    const first = measureAtBeat(score, 0)!;
    const second = measureAtBeat(score, score.measures[7].startBeats)!;
    expect(first.number).toBe(second.number);
    expect(first.pass).toBe(0);
    expect(second.pass).toBe(1);
  });

  it('reports the notes sounding at a moment', () => {
    const soprano = partByLabel(score, 'Soprano');
    expect(eventsAtBeat(soprano, 0)).toEqual([soprano.events[0].midiPitch]);
  });

  it('gives a readable band range even for a narrow part', () => {
    const bass = partByLabel(score, 'Bass');
    const range = bandPitchRange(bass);
    expect(range.minMidi).toBeLessThan(bass.range!.minMidi);
    expect(range.maxMidi).toBeGreaterThan(bass.range!.maxMidi);
    expect(range.maxMidi - range.minMidi).toBeGreaterThanOrEqual(7);
  });

  it('formats the transport clock', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(9)).toBe('0:09');
    expect(formatTime(75)).toBe('1:15');
    expect(formatTime(-3)).toBe('0:00');
  });
});
