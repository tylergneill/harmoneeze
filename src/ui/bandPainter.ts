import type { Part, Score } from '../core/types';
import { bandPitchRange } from '../core/timeline';
import { isNaturalPitch } from '../core/pitch';

/**
 * Piano-roll drawing (execution doc §6.2).
 *
 * Notes are dots on a pitch scale, not staff notation. The thing the user is
 * trying to learn is the contour of their line, so contour gets the pixels:
 * generous band height, clear dots, and a muted background that never competes
 * with them.
 */

/** One colour per band, walked in order. Distinct at a glance, all legible. */
export const BAND_COLORS = [
  '#6aa9ff',
  '#ffcb6b',
  '#7fd88f',
  '#ff9a76',
  '#c792ea',
  '#5fd3d0',
  '#f28fb4',
  '#b0bec5',
];

export function bandColor(index: number): string {
  return BAND_COLORS[index % BAND_COLORS.length];
}

export interface BandPaintOptions {
  part: Part;
  score: Score;
  color: string;
  /** Horizontal scale: pixels per quarter note. */
  pixelsPerBeat: number;
  /** CSS pixel size of the canvas. */
  width: number;
  height: number;
  /** Device pixel ratio, so dots stay crisp on retina displays. */
  dpr: number;
  /** Dim the band when its fader is at zero. */
  muted: boolean;
}

/** Draw one part's band. Called on layout change, not per animation frame. */
export function paintBand(canvas: HTMLCanvasElement, options: BandPaintOptions): void {
  const { part, score, color, pixelsPerBeat, width, height, dpr, muted } = options;

  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  if (ctx === null) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const range = bandPitchRange(part);
  const span = Math.max(1, range.maxMidi - range.minMidi);
  const yFor = (midi: number): number => height - ((midi - range.minMidi) / span) * height;

  // Background: faint stripes on the naturals give a sense of pitch without
  // asking the user to read anything.
  ctx.fillStyle = '#1a1d23';
  ctx.fillRect(0, 0, width, height);

  const semitoneHeight = height / span;
  if (semitoneHeight >= 3) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.022)';
    for (let midi = Math.ceil(range.minMidi); midi <= range.maxMidi; midi++) {
      if (!isNaturalPitch(midi)) continue;
      ctx.fillRect(0, yFor(midi + 0.5), width, semitoneHeight);
    }
  }

  // Measure lines, so the user can see where the bars fall.
  for (const measure of score.measures) {
    const x = measure.startBeats * pixelsPerBeat;
    // A heavier line where a repeat sends the music back, since that is where
    // the timeline stops matching the printed page.
    const isSeam = measure.pass > 0 && (score.measures[measure.index - 1]?.pass ?? 0) === 0;
    ctx.fillStyle = isSeam ? 'rgba(255, 203, 107, 0.22)' : 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(Math.round(x), 0, 1, height);
  }

  // Notes.
  const noteHeight = Math.max(4, Math.min(11, semitoneHeight * 0.9));
  const radius = noteHeight / 2;
  ctx.globalAlpha = muted ? 0.4 : 1;

  for (const event of part.events) {
    const x = event.onsetBeats * pixelsPerBeat;
    const w = Math.max(noteHeight, event.durationBeats * pixelsPerBeat - 1.5);
    const y = yFor(event.midiPitch) - radius;

    ctx.fillStyle = color;
    ctx.beginPath();
    // A rounded capsule reads as a dot for short notes and as a held line for
    // long ones, which is exactly the distinction that matters when singing.
    ctx.roundRect(x, y, w, noteHeight, radius);
    ctx.fill();
  }

  ctx.globalAlpha = 1;

  if (part.events.length === 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('(silent)', 10, height / 2 + 4);
  }
}

/** Draw the time ruler: measure numbers and repeat-pass marks. */
export function paintRuler(
  canvas: HTMLCanvasElement,
  score: Score,
  pixelsPerBeat: number,
  width: number,
  height: number,
  dpr: number,
): void {
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));

  const ctx = canvas.getContext('2d');
  if (ctx === null) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  // Label every measure when there is room, else thin them out.
  const measureWidth = (score.measures[0]?.durationBeats ?? 4) * pixelsPerBeat;
  const step = measureWidth < 34 ? Math.ceil(34 / Math.max(1, measureWidth)) : 1;

  for (const measure of score.measures) {
    const x = measure.startBeats * pixelsPerBeat;
    const isSeam = measure.pass > 0 && (score.measures[measure.index - 1]?.pass ?? 0) === 0;

    ctx.fillStyle = isSeam ? 'rgba(255, 203, 107, 0.5)' : 'rgba(255, 255, 255, 0.14)';
    ctx.fillRect(Math.round(x), 0, 1, height);

    if (measure.index % step !== 0) continue;

    // A repeated measure is labelled with a prime so the user can tell the
    // second pass from the first — the printed bar number is ambiguous there.
    const label = measure.pass > 0 ? `${measure.number}'` : measure.number;
    ctx.fillStyle = measure.pass > 0 ? 'rgba(255, 203, 107, 0.75)' : 'rgba(255, 255, 255, 0.45)';
    ctx.fillText(label, Math.round(x) + 4, height / 2);
  }
}
