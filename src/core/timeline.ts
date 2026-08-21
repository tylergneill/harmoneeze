import type { Part, Score, TimelineMeasure } from './types';

/** Convert quarter notes to seconds at a given tempo. */
export function beatsToSeconds(beats: number, tempoBpm: number): number {
  return (beats / tempoBpm) * 60;
}

export function secondsToBeats(seconds: number, tempoBpm: number): number {
  return (seconds / 60) * tempoBpm;
}

/** The measure containing a beat position, or null when out of range. */
export function measureAtBeat(score: Score, beats: number): TimelineMeasure | null {
  for (const m of score.measures) {
    if (beats >= m.startBeats && beats < m.startBeats + m.durationBeats) return m;
  }
  return null;
}

/**
 * Snap a beat position to the nearest measure line.
 *
 * Loop regions are dragged by hand but almost always intended to land on a
 * measure — a chorus starts where a bar starts. Snapping makes the common
 * case exact without preventing a deliberate off-grid region, since the
 * caller decides whether to snap at all.
 */
export function snapToMeasure(score: Score, beats: number): number {
  const lines = [...score.measures.map((m) => m.startBeats), score.durationBeats];
  let best = lines[0] ?? 0;
  let bestDistance = Infinity;
  for (const line of lines) {
    const distance = Math.abs(line - beats);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = line;
    }
  }
  return best;
}

/**
 * Normalise a dragged region into a valid loop.
 *
 * Returns null when the drag is too short to be a real selection, which is
 * how a click (as opposed to a drag) clears the region back to whole-song.
 */
export function normalizeLoopRegion(
  score: Score,
  aBeats: number,
  bBeats: number,
  minBeats = 0.5,
): { startBeats: number; endBeats: number } | null {
  const start = Math.max(0, Math.min(aBeats, bBeats));
  const end = Math.min(score.durationBeats, Math.max(aBeats, bBeats));
  if (end - start < minBeats) return null;
  return { startBeats: start, endBeats: end };
}

/** The span the transport should loop: the region, or the whole song. */
export function effectiveLoop(
  score: Score,
  region: { startBeats: number; endBeats: number } | null,
): { startBeats: number; endBeats: number } {
  if (region === null) return { startBeats: 0, endBeats: score.durationBeats };
  return region;
}

/** Pitch span to draw a part's band over, padded so dots are not clipped. */
export function bandPitchRange(part: Part, padSemitones = 2): { minMidi: number; maxMidi: number } {
  if (part.range === null) return { minMidi: 60 - padSemitones, maxMidi: 72 + padSemitones };

  // A part that barely moves would otherwise be drawn as a flat line filling
  // the band; enforce a floor so its contour reads at a sensible scale.
  const minSpan = 7;
  let { minMidi, maxMidi } = part.range;
  const span = maxMidi - minMidi;
  if (span < minSpan) {
    const grow = (minSpan - span) / 2;
    minMidi -= grow;
    maxMidi += grow;
  }
  return { minMidi: minMidi - padSemitones, maxMidi: maxMidi + padSemitones };
}

/** Notes sounding at a beat position — used to highlight the current chord. */
export function eventsAtBeat(part: Part, beats: number): number[] {
  const out: number[] = [];
  for (const e of part.events) {
    if (beats >= e.onsetBeats && beats < e.onsetBeats + e.durationBeats) out.push(e.midiPitch);
  }
  return out;
}

/** Format a beat position as m:ss for the transport readout. */
export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
