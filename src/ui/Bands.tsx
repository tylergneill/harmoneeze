import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MixState, Score } from '../core/types';
import { midiToName } from '../core/pitch';
import { bandColor, paintBand, paintRuler } from './bandPainter';

/**
 * The multi-band piano roll (execution doc §6.2).
 *
 * All bands share one horizontal time axis and one playhead. Dragging on the
 * ruler defines the loop region; clicking without dragging clears it back to
 * whole-song.
 */

const LABEL_WIDTH = 168;
const BAND_HEIGHT = 96;
const RULER_HEIGHT = 34;

interface Props {
  score: Score;
  mix: MixState;
  positionBeats: number;
  pixelsPerBeat: number;
  onVolumeChange: (partId: string, volume: number) => void;
  onFocusPart: (partId: string) => void;
  onLoopRegion: (a: number, b: number) => void;
  onSeek: (beats: number) => void;
}

export function Bands({
  score,
  mix,
  positionBeats,
  pixelsPerBeat,
  onVolumeChange,
  onFocusPart,
  onLoopRegion,
  onSeek,
}: Props) {
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const canvasRefs = useRef(new Map<string, HTMLCanvasElement>());
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  const contentWidth = Math.max(320, score.durationBeats * pixelsPerBeat);

  // Repaint whenever the layout or the mix changes. Not per frame: the
  // playhead is a DOM overlay, so animation never touches the canvases.
  useLayoutEffect(() => {
    const dpr = window.devicePixelRatio || 1;

    for (const [index, part] of score.parts.entries()) {
      const canvas = canvasRefs.current.get(part.id);
      if (canvas === undefined) continue;
      paintBand(canvas, {
        part,
        score,
        color: bandColor(index),
        pixelsPerBeat,
        width: contentWidth,
        height: BAND_HEIGHT,
        dpr,
        muted: (mix.volumes[part.id] ?? 0) === 0,
      });
    }

    if (rulerRef.current !== null) {
      paintRuler(rulerRef.current, score, pixelsPerBeat, contentWidth, RULER_HEIGHT, dpr);
    }
  }, [score, pixelsPerBeat, contentWidth, mix.volumes]);

  /**
   * Convert a pointer event to a beat position.
   *
   * Measured against the ruler element itself rather than the scroll
   * container: its rect already accounts for both the label gutter and the
   * current scroll offset, so neither has to be corrected for by hand.
   */
  const beatsFromEvent = (clientX: number): number => {
    const ruler = rulerRef.current;
    if (ruler === null) return 0;
    const rect = ruler.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(score.durationBeats, x / pixelsPerBeat));
  };

  // Drag on the ruler selects a loop region. Listeners go on the window so the
  // drag survives the pointer leaving the ruler, which it always does.
  useEffect(() => {
    if (drag === null) return;

    const move = (e: PointerEvent) => {
      setDrag((d) => (d === null ? null : { ...d, to: beatsFromEvent(e.clientX) }));
    };
    const up = (e: PointerEvent) => {
      const to = beatsFromEvent(e.clientX);
      onLoopRegion(drag.from, to);
      setDrag(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, onLoopRegion, pixelsPerBeat, score.durationBeats]);

  const loop = mix.loopRegion;
  const playheadX = positionBeats * pixelsPerBeat;
  const previewing = drag !== null;
  const previewStart = drag === null ? 0 : Math.min(drag.from, drag.to) * pixelsPerBeat;
  const previewWidth = drag === null ? 0 : Math.abs(drag.to - drag.from) * pixelsPerBeat;

  return (
    <div className="bands-scroll">
      <div className="bands" style={{ width: LABEL_WIDTH + contentWidth }}>
        <div className="ruler-row">
          <div className="ruler-gutter">Bar</div>
          <div
            className="ruler"
            style={{ width: contentWidth }}
            onPointerDown={(e) => {
              e.preventDefault();
              const from = beatsFromEvent(e.clientX);
              setDrag({ from, to: from });
            }}
            onDoubleClick={(e) => onSeek(beatsFromEvent(e.clientX))}
            title="Drag to set a loop region · double-click to move the playhead"
          >
            <canvas ref={rulerRef} />
          </div>
        </div>

        {score.parts.map((part, index) => {
          const volume = mix.volumes[part.id] ?? 0;
          const isFocus = mix.focusPartId === part.id;
          return (
            <div
              key={part.id}
              className={volume === 0 ? 'band-row band-muted' : 'band-row'}
            >
              <div className="band-label">
                <button
                  className={isFocus ? 'band-name is-focus' : 'band-name'}
                  style={{ color: isFocus ? undefined : bandColor(index) }}
                  onClick={() => onFocusPart(part.id)}
                  title="Make this the focus part"
                >
                  <span className="dot" />
                  {part.label}
                </button>

                <span className="band-range">
                  {part.range === null
                    ? 'silent'
                    : `${midiToName(part.range.minMidi)}–${midiToName(part.range.maxMidi)}`}
                </span>

                <div className="fader">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volume}
                    aria-label={`${part.label} volume`}
                    onChange={(e) => onVolumeChange(part.id, Number(e.target.value))}
                  />
                  <span className="value">{volume}</span>
                </div>
              </div>

              <div className="band-canvas-wrap" style={{ width: contentWidth }}>
                <canvas
                  ref={(el) => {
                    if (el === null) canvasRefs.current.delete(part.id);
                    else canvasRefs.current.set(part.id, el);
                  }}
                />
              </div>
            </div>
          );
        })}

        <div className="overlay" style={{ width: contentWidth }}>
          {/* Everything outside the loop is shaded, so the practised span
              reads as the lit part of the timeline. */}
          {loop !== null && !previewing && (
            <>
              <div
                className="loop-shade"
                style={{ left: 0, width: loop.startBeats * pixelsPerBeat }}
              />
              <div
                className="loop-shade"
                style={{
                  left: loop.endBeats * pixelsPerBeat,
                  width: Math.max(0, contentWidth - loop.endBeats * pixelsPerBeat),
                }}
              />
              <div className="loop-edge" style={{ left: loop.startBeats * pixelsPerBeat }} />
              <div className="loop-edge" style={{ left: loop.endBeats * pixelsPerBeat }} />
            </>
          )}

          {previewing && (
            <div
              className="loop-edge"
              style={{ left: previewStart, width: previewWidth, opacity: 0.25, background: 'var(--focus)' }}
            />
          )}

          <div className="playhead" style={{ left: playheadX }} />
        </div>
      </div>
    </div>
  );
}
