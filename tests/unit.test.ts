import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { parseXml } from '../src/core/xmlParse';
import { parseMusicXml } from '../src/core/musicxml';
import { parseScoreFile } from '../src/core/ingest';
import { unrollMeasures } from '../src/core/unroll';
import { fixturePath } from './helpers';

/**
 * Unit tests over hand-written minimal scores.
 *
 * These isolate one behaviour each, so a failure names the broken rule
 * directly rather than pointing at a whole fixture.
 */

/** Wrap measures in the minimum valid single-part score. */
function score(measuresXml: string, partName = 'Test'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>${partName}</part-name></score-part></part-list>
  <part id="P1">${measuresXml}</part>
</score-partwise>`;
}

function note(step: string, octave: number, duration: number, extra = ''): string {
  return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>1</voice>${extra}</note>`;
}

const ATTRS = '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';

function parse(xml: string) {
  return parseMusicXml(parseXml(xml));
}

describe('XML reader', () => {
  it('reads attributes, nesting, and text', () => {
    const root = parseXml('<a x="1"><b>hi</b><b>there</b></a>');
    expect(root.tag).toBe('a');
    expect(root.attr('x')).toBe('1');
    expect(root.children('b').map((c) => c.text())).toEqual(['hi', 'there']);
    expect(root.attr('missing')).toBeNull();
  });

  it('decodes entities and character references', () => {
    const root = parseXml('<a><b>A &amp; B &lt;C&gt; &#65; &#x42;</b></a>');
    expect(root.child('b')!.text()).toBe('A & B <C> A B');
  });

  it('skips comments, declarations, and DOCTYPE', () => {
    const root = parseXml(
      '<?xml version="1.0"?><!DOCTYPE score-partwise PUBLIC "x" "y"><!-- note --><a><b/></a>',
    );
    expect(root.tag).toBe('a');
    expect(root.children()).toHaveLength(1);
  });

  it('handles self-closing elements', () => {
    const root = parseXml('<a><rest/><chord/></a>');
    expect(root.child('rest')).not.toBeNull();
    expect(root.child('nope')).toBeNull();
  });

  it('reads CDATA as text', () => {
    expect(parseXml('<a><![CDATA[<raw> & stuff]]></a>').text()).toBe('<raw> & stuff');
  });

  it('rejects mismatched and unclosed tags', () => {
    expect(() => parseXml('<a><b></c></a>')).toThrow(/closes/);
    expect(() => parseXml('<a><b></a>')).toThrow();
    expect(() => parseXml('   ')).toThrow(/no root element/);
  });
});

describe('ties', () => {
  it('merges a note tied across a barline into one held note', () => {
    const s = parse(
      score(
        `<measure number="1">${ATTRS}${note('C', 4, 4, '<tie type="start"/>')}</measure>
         <measure number="2">${note('C', 4, 4, '<tie type="stop"/>')}</measure>`,
      ),
    );
    expect(s.parts[0].events).toHaveLength(1);
    expect(s.parts[0].events[0]).toMatchObject({
      onsetBeats: 0,
      durationBeats: 8,
      midiPitch: 60,
    });
  });

  it('merges a chain of three tied notes', () => {
    const s = parse(
      score(
        `<measure number="1">${ATTRS}${note('D', 4, 4, '<tie type="start"/>')}</measure>
         <measure number="2">${note('D', 4, 4, '<tie type="stop"/><tie type="start"/>')}</measure>
         <measure number="3">${note('D', 4, 4, '<tie type="stop"/>')}</measure>`,
      ),
    );
    expect(s.parts[0].events).toHaveLength(1);
    expect(s.parts[0].events[0].durationBeats).toBe(12);
  });

  it('accepts <tied> inside <notations> as well as <tie>', () => {
    const s = parse(
      score(
        `<measure number="1">${ATTRS}${note('E', 4, 4, '<notations><tied type="start"/></notations>')}</measure>
         <measure number="2">${note('E', 4, 4, '<notations><tied type="stop"/></notations>')}</measure>`,
      ),
    );
    expect(s.parts[0].events).toHaveLength(1);
    expect(s.parts[0].events[0].durationBeats).toBe(8);
  });

  it('does not merge a repeated note that is not tied', () => {
    const s = parse(
      score(
        `<measure number="1">${ATTRS}${note('C', 4, 4)}${note('C', 4, 4)}</measure>`,
      ),
    );
    expect(s.parts[0].events).toHaveLength(2);
  });

  it('does not merge notes at different pitches', () => {
    const s = parse(
      score(
        `<measure number="1">${ATTRS}${note('C', 4, 4, '<tie type="start"/>')}${note('D', 4, 4, '<tie type="stop"/>')}</measure>`,
      ),
    );
    expect(s.parts[0].events).toHaveLength(2);
  });
});

describe('measure content', () => {
  it('advances past rests without emitting an event', () => {
    const s = parse(
      score(
        `<measure number="1">${ATTRS}<note><rest/><duration>2</duration><voice>1</voice></note>${note('G', 4, 2)}</measure>`,
      ),
    );
    expect(s.parts[0].events).toHaveLength(1);
    expect(s.parts[0].events[0].onsetBeats).toBe(2);
  });

  it('sounds chord members together', () => {
    const s = parse(
      score(
        `<measure number="1">${ATTRS}${note('C', 4, 4)}${note('E', 4, 4, '<chord/>')}${note('G', 4, 4, '<chord/>')}</measure>`,
      ),
    );
    const onsets = s.parts[0].events.map((e) => e.onsetBeats);
    expect(onsets).toEqual([0, 0, 0]);
    expect(s.parts[0].events.map((e) => e.midiPitch)).toEqual([60, 64, 67]);
  });

  it('rewinds the cursor on <backup> so a second voice starts over', () => {
    const s = parse(
      score(
        `<measure number="1">${ATTRS}${note('C', 5, 4)}<backup><duration>4</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice></note></measure>`,
      ),
    );
    expect(s.parts).toHaveLength(2);
    expect(s.parts[0].events[0].onsetBeats).toBe(0);
    expect(s.parts[1].events[0].onsetBeats).toBe(0);
  });

  it('skips ahead on <forward>', () => {
    const s = parse(
      score(
        `<measure number="1">${ATTRS}<forward><duration>2</duration></forward>${note('A', 4, 2)}</measure>`,
      ),
    );
    expect(s.parts[0].events[0].onsetBeats).toBe(2);
  });

  it('ignores grace notes rather than letting them shift the beat', () => {
    const s = parse(
      score(
        `<measure number="1">${ATTRS}<note><grace/><pitch><step>B</step><octave>4</octave></pitch><voice>1</voice></note>${note('C', 5, 4)}</measure>`,
      ),
    );
    expect(s.parts[0].events).toHaveLength(1);
    expect(s.parts[0].events[0].onsetBeats).toBe(0);
  });

  it('scales durations by <divisions>', () => {
    const attrs = '<attributes><divisions>256</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
    const s = parse(
      score(`<measure number="1">${attrs}${note('C', 4, 512)}</measure>`),
    );
    // 512 divisions at 256 per quarter is a half note.
    expect(s.parts[0].events[0].durationBeats).toBe(2);
  });

  it('gives a rested measure its full notated length', () => {
    // A measure the part rests through still occupies its full width, so the
    // bands of a sparse part stay aligned with everyone else's.
    const s = parse(
      score(
        `<measure number="1">${ATTRS}<note><rest/><duration>4</duration><voice>1</voice></note></measure>
         <measure number="2">${note('C', 4, 4)}</measure>`,
      ),
    );
    expect(s.measures[0].durationBeats).toBe(4);
    expect(s.measures[1].startBeats).toBe(4);
    // The single sounding note lands in the second measure, not the first.
    expect(s.parts[0].events[0].onsetBeats).toBe(4);
  });
});

describe('tempo', () => {
  const timed = (attrs: string, body = '') =>
    parse(score(`<measure number="1">${attrs}${body}${note('C', 4, 4)}</measure>`));

  const cut = '<attributes><divisions>1</divisions><time><beats>2</beats><beat-type>2</beat-type></time></attributes>';

  it('takes <sound tempo> as quarter notes per minute', () => {
    expect(timed(ATTRS, '<sound tempo="132"/>').tempoBpm).toBe(132);
  });

  it('reads a <sound tempo> nested in a <direction>', () => {
    expect(timed(ATTRS, '<direction><sound tempo="88"/></direction>').tempoBpm).toBe(88);
  });

  it('converts a metronome mark through its beat unit', () => {
    // "half = 100" in cut time is 200 quarter notes per minute.
    const s = timed(
      cut,
      '<direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>100</per-minute></metronome></direction-type></direction>',
    );
    expect(s.tempoBpm).toBe(200);
  });

  it('accounts for a dotted beat unit', () => {
    const s = timed(
      ATTRS,
      '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>80</per-minute></metronome></direction-type></direction>',
    );
    expect(s.tempoBpm).toBe(120);
  });

  it('prefers <sound tempo> over a metronome mark', () => {
    const s = timed(
      ATTRS,
      '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>60</per-minute></metronome></direction-type><sound tempo="140"/></direction>',
    );
    expect(s.tempoBpm).toBe(140);
  });

  it('scales the default by the beat unit when the score says nothing', () => {
    // Real exports often carry no tempo at all. Treating the default as
    // quarter notes in cut time plays a shanty at half speed, and the
    // playhead visibly lags the music.
    expect(timed(ATTRS).tempoBpm).toBe(100);
    expect(timed(cut).tempoBpm).toBe(200);
  });
});

describe('repeat structure', () => {
  const measures = (xml: string) => parseXml(score(xml)).children('part')[0].children('measure');

  it('leaves a score with no repeats alone', () => {
    const w: string[] = [];
    const steps = unrollMeasures(measures('<measure number="1"/><measure number="2"/>'), w);
    expect(steps.map((s) => s.writtenIndex)).toEqual([0, 1]);
    expect(w).toEqual([]);
  });

  it('repeats a simple section twice', () => {
    const w: string[] = [];
    const steps = unrollMeasures(
      measures(
        `<measure number="1"><barline location="left"><repeat direction="forward"/></barline></measure>
         <measure number="2"><barline location="right"><repeat direction="backward"/></barline></measure>
         <measure number="3"/>`,
      ),
      w,
    );
    expect(steps.map((s) => s.writtenIndex)).toEqual([0, 1, 0, 1, 2]);
  });

  it('honours repeat times greater than two', () => {
    const w: string[] = [];
    const steps = unrollMeasures(
      measures(
        `<measure number="1"><barline location="left"><repeat direction="forward"/></barline></measure>
         <measure number="2"><barline location="right"><repeat direction="backward" times="3"/></barline></measure>`,
      ),
      w,
    );
    expect(steps.map((s) => s.writtenIndex)).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('repeats from the start when there is no forward repeat', () => {
    const w: string[] = [];
    const steps = unrollMeasures(
      measures(
        `<measure number="1"/>
         <measure number="2"><barline location="right"><repeat direction="backward"/></barline></measure>`,
      ),
      w,
    );
    expect(steps.map((s) => s.writtenIndex)).toEqual([0, 1, 0, 1]);
  });

  it('takes first and second endings on the right passes', () => {
    const w: string[] = [];
    const steps = unrollMeasures(
      measures(
        `<measure number="1"><barline location="left"><repeat direction="forward"/></barline></measure>
         <measure number="2"><barline location="left"><ending number="1" type="start"/></barline><barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure>
         <measure number="3"><barline location="left"><ending number="2" type="start"/></barline><barline location="right"><ending number="2" type="discontinue"/></barline></measure>`,
      ),
      w,
    );
    // m1, first ending, back to m1, then the second ending.
    expect(steps.map((s) => s.writtenIndex)).toEqual([0, 1, 0, 2]);
  });

  it('gives up safely on a pathological repeat structure', () => {
    const w: string[] = [];
    const steps = unrollMeasures(
      measures(
        `<measure number="1"><barline location="left"><repeat direction="forward"/></barline></measure>
         <measure number="2"><barline location="right"><repeat direction="backward" times="999999"/></barline></measure>`,
      ),
      w,
      50,
    );
    // Bounded rather than hanging, and the user is told.
    expect(steps.length).toBeLessThanOrEqual(50);
    expect(w.join(' ')).toMatch(/too complex or malformed/);
  });
});

describe('part labelling', () => {
  it('falls back to the instrument name when there is no part name', () => {
    const s = parse(`<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name></part-name><score-instrument id="I1"><instrument-name>Viola</instrument-name></score-instrument></score-part></part-list>
  <part id="P1"><measure number="1">${ATTRS}${note('C', 4, 4)}</measure></part>
</score-partwise>`);
    expect(s.parts[0].label).toBe('Viola');
  });

  it('falls back to the part id when the score names nothing', () => {
    const s = parse(`<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P7"/></part-list>
  <part id="P7"><measure number="1">${ATTRS}${note('C', 4, 4)}</measure></part>
</score-partwise>`);
    expect(s.parts[0].label).toBe('Part P7');
  });

  it('numbers the voices when one staff carries several', () => {
    const s = parse(
      score(
        `<measure number="1">${ATTRS}${note('C', 5, 4)}<backup><duration>4</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice></note></measure>`,
        'Piano',
      ),
    );
    expect(s.parts.map((p) => p.label)).toEqual(['Piano 1', 'Piano 2']);
  });
});

describe('compressed MusicXML (.mxl)', () => {
  // .mxl is what MuseScore and Sibelius export by default, so it is the first
  // thing a real user hands the app. The archive is built here from a fixture
  // rather than read from disk, so this covers the container-manifest path
  // without depending on any downloaded file.
  const CONTAINER =
    '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles>' +
    '<rootfile full-path="score.xml"/></rootfiles></container>';

  const simple = readFileSync(fixturePath('wellerman-fixture-simple.musicxml'), 'utf8');

  const toMxl = (files: Record<string, string>): ArrayBuffer => {
    const encoded: Record<string, Uint8Array> = {};
    for (const [name, text] of Object.entries(files)) encoded[name] = strToU8(text);
    const zipped = zipSync(encoded);
    return zipped.buffer.slice(
      zipped.byteOffset,
      zipped.byteOffset + zipped.byteLength,
    ) as ArrayBuffer;
  };

  it('unzips a score named by the container manifest', () => {
    const bytes = toMxl({ 'META-INF/container.xml': CONTAINER, 'score.xml': simple });
    const score = parseScoreFile('wellerman.mxl', bytes, parseXml);
    // Same music as the uncompressed fixture, so the repeat unroll still holds.
    expect(score.measures).toHaveLength(22);
    expect(score.parts.map((p) => p.label)).toEqual(['Soprano', 'Alto', 'Tenor', 'Bass']);
  });

  it('follows the manifest rather than guessing, when several files are present', () => {
    const decoy = score(`<measure number="1">${ATTRS}${note('C', 4, 4)}</measure>`, 'Decoy');
    const bytes = toMxl({
      'META-INF/container.xml': CONTAINER,
      // Sorts before score.xml, so a parser that took the first entry would
      // pick this one.
      'other.xml': decoy,
      'score.xml': simple,
    });
    expect(parseScoreFile('x.mxl', bytes, parseXml).parts).toHaveLength(4);
  });

  it('falls back to the first plausible score when the manifest is missing', () => {
    const bytes = toMxl({ 'score.xml': simple });
    expect(parseScoreFile('x.mxl', bytes, parseXml).parts).toHaveLength(4);
  });

  it('ignores META-INF when falling back', () => {
    const bytes = toMxl({ 'META-INF/junk.xml': '<junk/>', 'score.xml': simple });
    expect(parseScoreFile('x.mxl', bytes, parseXml).parts).toHaveLength(4);
  });

  it('explains itself when the archive holds no score', () => {
    const bytes = toMxl({ 'META-INF/container.xml': CONTAINER, 'readme.txt': 'hello' });
    expect(() => parseScoreFile('x.mxl', bytes, parseXml)).toThrow(/does not contain a MusicXML/);
  });
});

describe('ingest', () => {
  const buf = (s: string): ArrayBuffer => {
    const bytes = new TextEncoder().encode(s);
    return bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer;
  };

  it('parses plain MusicXML', () => {
    const s = parseScoreFile('x.musicxml', buf(score(`<measure number="1">${ATTRS}${note('C', 4, 4)}</measure>`)), parseXml);
    expect(s.parts).toHaveLength(1);
  });

  it('strips a UTF-8 BOM', () => {
    const s = parseScoreFile('x.musicxml', buf('﻿' + score(`<measure number="1">${ATTRS}${note('C', 4, 4)}</measure>`)), parseXml);
    expect(s.parts).toHaveLength(1);
  });

  it('names the project after the file when the score has no title', () => {
    const s = parseScoreFile('My Song.musicxml', buf(score(`<measure number="1">${ATTRS}${note('C', 4, 4)}</measure>`)), parseXml);
    expect(s.title).toBe('My Song');
  });

  it('explains itself on files it cannot use', () => {
    expect(() => parseScoreFile('a.txt', buf(''), parseXml)).toThrow(/empty/i);
    expect(() => parseScoreFile('a.txt', buf('hello'), parseXml)).toThrow(/MusicXML/);
    expect(() => parseScoreFile('a.xml', buf('<html><body/></html>'), parseXml)).toThrow(/not a MusicXML score/);
  });

  it('rejects timewise MusicXML with a usable message', () => {
    expect(() =>
      parseScoreFile('a.xml', buf('<?xml version="1.0"?><score-timewise><measure number="1"/></score-timewise>'), parseXml),
    ).toThrow(/timewise/i);
  });

  it('rejects a score with no notes rather than showing empty bands', () => {
    expect(() =>
      parse(score(`<measure number="1">${ATTRS}<note><rest/><duration>4</duration><voice>1</voice></note></measure>`)),
    ).toThrow(/no notes/);
  });
});
