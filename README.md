# harmoneeze

Minimalistic interface for practicing a cappella harmonies.

Upload a score, turn everyone else down, loop the tricky bit, and sing along until
it sticks. There is no assessment, no microphone, and no notation editing —
looping and repetition is the entire pedagogy.

This is **Milestone 1** of [the execution doc](design_docs/harmoneeze-execution-doc.md):
the practice instrument, with MusicXML import only. OMR (image/PDF ingest) and the
note-level correction surface are M2/M3 and are not built.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm test         # 92 tests
npm run build    # typecheck + production bundle
```

Everything runs in the browser. There is no server, and no uploaded score ever
leaves the machine — projects live in IndexedDB.

## What it does

- **Import** MusicXML (`.musicxml`, `.xml`) and compressed MusicXML (`.mxl`).
- **Unroll repeats** into a linear timeline, so the playhead matches what you hear
  rather than what is printed. Repeated bars are labelled `7'` on the ruler.
- **Split voices sharing a staff** into separate parts, so an SA-on-one-treble-staff
  score gives four faders rather than two.
- **Band view**: one piano-roll lane per part, dots on a pitch scale, shared time axis.
- **Mixer** with three fader link modes, including *All but mine* — move everyone
  except your part.
- **Loop** any span by dragging across the bar ruler; snaps to bar lines.
- **Tempo** from 40% to 130% for slow practice.
- **Notes pane**, autosaved per project.

Keyboard: <kbd>space</kbd> play/pause · <kbd>S</kbd> just my part · <kbd>L</kbd>
clear loop · <kbd>0</kbd> reset faders · <kbd>Esc</kbd> stop.

## Layout

```
src/core/      parsing and domain logic — no DOM, no audio, fully tested
  types.ts       the data model (§4)
  xmlParse.ts    dependency-free XML reader (Node + tests)
  domXml.ts      the same interface over DOMParser (browser)
  musicxml.ts    score parsing: voices, ties, backup/forward cursor
  unroll.ts      repeat and volta expansion
  ingest.ts      file sniffing and .mxl unzipping
  mixer.ts       fader link modes
  timeline.ts    loop regions, snapping, pitch ranges
src/audio/     Tone.js transport and one synth per part
src/storage/   IndexedDB projects
src/ui/        React components
tests/         vitest
```

The parser is written against a small `XmlElement` interface with two
implementations, so identical parsing code runs in the browser and under Node.
Time is in quarter notes everywhere; MusicXML `divisions` never escape the parser.

## Tests

```
tests/parser.test.ts   the fixtures, with exact known-good assertions
tests/unit.test.ts     one behaviour each, over hand-written minimal scores
tests/mixer.test.ts    link modes, loop regions, timeline helpers
tests/real.test.ts     Bach BWV 269 and four real Wellerman arrangements
```

`real.test.ts` reads from `downloads/`, which is gitignored; those blocks skip
cleanly on a fresh clone.

The load-bearing assertion is the unroll count: the fixture's **16 written measures
must unroll to 22**. If that reports 16, repeats are not being expanded and the
playhead will drift out of sync with the bands.

## Verified end to end

The acceptance test from the fixture README — load the simple fixture, mute
everything but Bass, loop the chorus, play — was run in the browser and works.
The real-world `.mxl` files in `downloads/` were also driven through the full
flow: a 5-part SATB+solo arrangement unzips, parses, renders, and plays.

## Licence

[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — share and
adapt freely, with attribution, non-commercially, under the same terms. See
[LICENSE](LICENSE).

This covers the source and its own assets, not third-party dependencies and not
any score you import — imported scores stay under their own rights holders'
terms and never leave your browser.

## Known gaps

Untested territory, inherited from the test corpus: tuplets, mid-piece tempo or
key changes, D.S./coda jumps, multi-measure rests, and transposing instruments.
Chords, grace notes, and ties are handled. Divisi and cross-staff beaming take a
best guess and log a warning, per §5.2.
