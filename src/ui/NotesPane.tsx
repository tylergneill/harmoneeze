import { useEffect, useRef, useState } from 'react';

/**
 * Per-project notes (execution doc §6.2).
 *
 * "One freeform text area per project." Autosaves, and collapses so it does
 * not compete with the bands for space.
 */

interface Props {
  value: string;
  onChange: (value: string) => void;
}

const AUTOSAVE_DELAY_MS = 600;

export function NotesPane({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt notes from a different project when the pane is reused.
  useEffect(() => {
    setDraft(value);
    setSaved(true);
  }, [value]);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const edit = (next: string) => {
    setDraft(next);
    setSaved(false);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onChange(next);
      setSaved(true);
    }, AUTOSAVE_DELAY_MS);
  };

  return (
    <div className="notes">
      <div
        className="notes-head"
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>Notes</span>
        {open && <span className="saved-flag">{saved ? 'Saved' : 'Saving…'}</span>}
      </div>

      {open && (
        <div className="notes-body">
          <textarea
            value={draft}
            placeholder="What the lyrics mean, where the song comes from, anything that helps you enjoy it."
            onChange={(e) => edit(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
