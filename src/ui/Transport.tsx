import type { LinkMode, MixState, Score } from '../core/types';
import { beatsToSeconds, formatTime } from '../core/timeline';

/**
 * Transport, link-mode selector, and tempo (execution doc §6.2).
 */

interface Props {
  score: Score;
  mix: MixState;
  isPlaying: boolean;
  positionBeats: number;
  onPlayPause: () => void;
  onStop: () => void;
  onLinkMode: (mode: LinkMode) => void;
  onClearLoop: () => void;
  onSolo: () => void;
  onTempoScale: (scale: number) => void;
  onZoom: (delta: number) => void;
}

const LINK_MODES: { value: LinkMode; label: string; title: string }[] = [
  { value: 'independent', label: 'Independent', title: 'Each fader moves alone' },
  { value: 'all', label: 'All', title: 'Moving one fader moves them all' },
  {
    value: 'all-except-focus',
    label: 'All but mine',
    title: 'Move everyone except the focus part — turn the others down',
  },
];

export function Transport({
  score,
  mix,
  isPlaying,
  positionBeats,
  onPlayPause,
  onStop,
  onLinkMode,
  onClearLoop,
  onSolo,
  onTempoScale,
  onZoom,
}: Props) {
  const tempo = score.tempoBpm * mix.tempoScale;
  const position = beatsToSeconds(positionBeats, tempo);
  const total = beatsToSeconds(
    mix.loopRegion === null ? score.durationBeats : mix.loopRegion.endBeats - mix.loopRegion.startBeats,
    tempo,
  );

  return (
    <div className="transport">
      <button className="primary" onClick={onPlayPause}>
        {isPlaying ? '❚❚ Pause' : '▶ Play'}
      </button>
      <button onClick={onStop}>■ Stop</button>

      <span className="clock">
        {formatTime(position)} / {formatTime(total)}
      </span>

      <div className="group">
        <label>Faders</label>
        <div className="seg">
          {LINK_MODES.map((mode) => (
            <button
              key={mode.value}
              className={mix.linkMode === mode.value ? 'on' : ''}
              title={mode.title}
              onClick={() => onLinkMode(mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <button onClick={onSolo} title="Silence everything except the focus part">
        Just my part
      </button>

      <button onClick={onClearLoop} disabled={mix.loopRegion === null}>
        {mix.loopRegion === null ? 'Looping whole song' : 'Clear loop'}
      </button>

      <div className="group">
        <label htmlFor="tempo">Tempo</label>
        <input
          id="tempo"
          className="tempo"
          type="range"
          min={40}
          max={130}
          value={Math.round(mix.tempoScale * 100)}
          onChange={(e) => onTempoScale(Number(e.target.value) / 100)}
        />
        <span className="clock" style={{ minWidth: 62 }}>
          {Math.round(tempo)} bpm
        </span>
      </div>

      <span className="spacer" style={{ flex: 1 }} />

      <div className="group">
        <button className="ghost" onClick={() => onZoom(-1)} title="Zoom out">
          −
        </button>
        <button className="ghost" onClick={() => onZoom(1)} title="Zoom in">
          +
        </button>
      </div>
    </div>
  );
}
