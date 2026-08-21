import type { XmlElement } from './xml';

/**
 * Repeat unrolling (execution doc §10.1).
 *
 * The piano roll and the transport both need a single linear timeline. A
 * written score is not linear: repeat barlines and voltas mean some measures
 * sound more than once and others are skipped on a given pass. So before
 * anything else happens, the written measure sequence is expanded into the
 * order it is actually performed in.
 *
 * The doc's fixture is the reference case: 16 written measures unroll to 22.
 */

/** One entry in the performance order: an index into the written measures. */
export interface UnrolledStep {
  /** Index into the written measure list. */
  writtenIndex: number;
  /** 0 for the first time this measure sounds, 1 for the second, and so on. */
  pass: number;
}

interface Jump {
  /** Written index of a forward-repeat (the target to jump back to). */
  forwardAt: number[];
  /** Written index -> times to play, from `<repeat times="n">`. */
  backwardTimes: Map<number, number>;
  /** Written index -> volta numbers that measure belongs to. */
  endings: Map<number, Set<number>>;
  /** Written indices where a volta bracket begins. */
  endingStarts: Set<number>;
}

/** Volta numbers from an `<ending number="1,2">` attribute. */
function parseEndingNumbers(raw: string | null): number[] {
  if (raw === null) return [];
  const out: number[] = [];
  for (const piece of raw.split(',')) {
    const n = Number.parseInt(piece.trim(), 10);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * Collect repeat structure from a part's measures.
 *
 * MusicXML repeats live on `<barline>` elements. A given measure can carry a
 * left barline (forward repeat, volta start) and a right barline (backward
 * repeat, volta stop). Structure is normally identical across parts, so the
 * caller reads it from whichever part has the most measures.
 */
function collectJumps(measures: XmlElement[]): Jump {
  const jump: Jump = {
    forwardAt: [],
    backwardTimes: new Map(),
    endings: new Map(),
    endingStarts: new Set(),
  };

  // A volta bracket applies from its start measure until its stop; carry the
  // active numbers forward so multi-measure endings are covered, not just the
  // measure the bracket is drawn on.
  let activeEnding: Set<number> | null = null;

  measures.forEach((m, idx) => {
    let startsHere: Set<number> | null = null;
    let stopsHere = false;

    for (const bar of m.children('barline')) {
      const repeat = bar.child('repeat');
      if (repeat !== null) {
        const dir = repeat.attr('direction');
        if (dir === 'forward') {
          jump.forwardAt.push(idx);
        } else if (dir === 'backward') {
          const times = Number.parseInt(repeat.attr('times') ?? '2', 10);
          jump.backwardTimes.set(idx, Number.isFinite(times) && times >= 2 ? times : 2);
        }
      }

      const ending = bar.child('ending');
      if (ending !== null) {
        const type = ending.attr('type');
        const numbers = parseEndingNumbers(ending.attr('number'));
        if (type === 'start') {
          startsHere = new Set(numbers);
        } else if (type === 'stop' || type === 'discontinue') {
          stopsHere = true;
        }
      }
    }

    if (startsHere !== null) {
      activeEnding = startsHere;
      jump.endingStarts.add(idx);
    }
    if (activeEnding !== null) jump.endings.set(idx, activeEnding);
    if (stopsHere) activeEnding = null;
  });

  return jump;
}

/**
 * Expand written measures into performance order.
 *
 * The traversal walks measure by measure. On reaching a backward repeat it
 * jumps to the most recent forward repeat at or before it (or to the start of
 * the piece, which is what MusicXML means by a backward repeat with no
 * matching forward one — the Bach chorale relies on this). Volta measures are
 * skipped unless the current pass number is one the bracket names.
 *
 * `maxSteps` bounds the walk so a pathological or malformed repeat structure
 * cannot hang the app; if it trips, a warning is raised and the timeline is
 * whatever was produced up to that point.
 */
export function unrollMeasures(
  measures: XmlElement[],
  warnings: string[],
  maxSteps = 20000,
): UnrolledStep[] {
  const jump = collectJumps(measures);
  const steps: UnrolledStep[] = [];

  /** Times each backward repeat has been *taken* so far. */
  const repeatsTaken = new Map<number, number>();
  /** Times each written measure has been emitted, for volta pass numbers. */
  const playCount = new Map<number, number>();

  let idx = 0;
  let guard = 0;

  while (idx < measures.length) {
    if (++guard > maxSteps) {
      warnings.push(
        'Repeat structure is too complex or malformed to unroll fully; the timeline may be incomplete.',
      );
      break;
    }

    // Which pass of the enclosing repeat are we on? Voltas are numbered from
    // 1, and the pass is determined by how many times the repeat that governs
    // this volta has already sent us back.
    const endingNumbers = jump.endings.get(idx);
    if (endingNumbers !== undefined && jump.endingStarts.has(idx)) {
      const governing = governingRepeat(idx, jump, measures.length);
      const passNumber = (repeatsTaken.get(governing) ?? 0) + 1;
      if (!endingNumbers.has(passNumber)) {
        // This volta is not for this pass: skip to the end of its bracket.
        idx = endOfEnding(idx, jump, measures.length);
        continue;
      }
    }

    const pass = playCount.get(idx) ?? 0;
    steps.push({ writtenIndex: idx, pass });
    playCount.set(idx, pass + 1);

    const times = jump.backwardTimes.get(idx);
    if (times !== undefined) {
      const taken = repeatsTaken.get(idx) ?? 0;
      if (taken < times - 1) {
        repeatsTaken.set(idx, taken + 1);
        idx = mostRecentForwardBefore(idx, jump);
        continue;
      }
    }

    idx++;
  }

  return steps;
}

/** The forward repeat governing a backward repeat at `idx` (0 if none). */
function mostRecentForwardBefore(idx: number, jump: Jump): number {
  let best = 0;
  for (const f of jump.forwardAt) {
    if (f <= idx && f >= best) best = f;
  }
  return best;
}

/**
 * The backward repeat whose take-count decides which pass a volta belongs to.
 *
 * Two shapes have to work with one rule. A first ending *contains* the
 * backward repeat that sends the player back, so its governing repeat lies
 * inside its own bracket. A second ending sits *after* that repeat, so its
 * governing repeat lies before it. Searching backward from the last measure of
 * the volta's own bracket finds the right repeat in both cases: for volta 1
 * that is the repeat within the bracket, and for volta 2 the repeat that
 * precedes it.
 */
function governingRepeat(idx: number, jump: Jump, total: number): number {
  const lastInBracket = endOfEnding(idx, jump, total) - 1;
  for (let i = lastInBracket; i >= 0; i--) {
    if (jump.backwardTimes.has(i)) return i;
  }
  return mostRecentForwardBefore(idx, jump);
}

/** First measure index after the volta bracket beginning at `idx`. */
function endOfEnding(idx: number, jump: Jump, total: number): number {
  const numbers = jump.endings.get(idx);
  let i = idx;
  while (i < total) {
    const here = jump.endings.get(i);
    // Leave the bracket when the volta set changes or ends.
    if (here === undefined || here !== numbers) return i;
    i++;
  }
  return total;
}
