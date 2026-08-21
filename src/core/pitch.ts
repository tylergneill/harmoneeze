/** Semitone offset of each natural step above C. */
const STEP_SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/**
 * MusicXML <pitch> to MIDI note number.
 *
 * MusicXML octaves are scientific pitch: middle C is C4 and is MIDI 60,
 * so the octave multiplier is offset by one.
 */
export function pitchToMidi(step: string, octave: number, alter: number): number {
  const base = STEP_SEMITONES[step.toUpperCase()];
  if (base === undefined) throw new Error(`Unknown pitch step: ${step}`);
  return base + alter + (octave + 1) * 12;
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Human-readable name for a MIDI pitch, e.g. 60 -> "C4". Display only. */
export function midiToName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

/** True for the white keys of C major — used to stripe the band background. */
export function isNaturalPitch(midi: number): boolean {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 0 || pc === 2 || pc === 4 || pc === 5 || pc === 7 || pc === 9 || pc === 11;
}
