# Music Lab Studio

A grid-based song maker in the spirit of Chrome Music Lab's Song Maker — same
"click the squares, hear music" simplicity, but with the parts that toy misses:
many tracks, patterns you can arrange into a whole song, real effects, and
export to audio and MIDI.

No dependencies, no build step, no accounts, no uploads. Every sound is
synthesised in the browser, so it loads instantly and keeps working offline.

| | |
|---|---|
| **Play online** | https://zdstudios.github.io/music-lab/ |
| **Offline single file** | https://zdstudios.github.io/music-lab/offline.html — save the page, open it any time |
| **Windows / macOS / Linux app** | see [Desktop build](#desktop-build) |

---

## What it does

**Writing music**

- Multi-track grid — up to 10 tracks, each with its own instrument, volume, pan
  and octave. Melody tracks show a pitch ladder; drum tracks show their kit.
- Notes have **length** (drag sideways) and **velocity** — soft, normal,
  accented (<kbd>Alt</kbd>+click to cycle).
- Draw, erase and box-select tools. Copy, paste, transpose and nudge a
  selection with the arrow keys.
- **Unlimited undo/redo.**
- Fold a track down to a single summary lane when the grid gets busy.

**Sound**

- 11 synthesised melodic instruments — marimba, piano, music box, plucked
  strings, strings, brass, flute, organ, synth lead, warm pad, bass.
- 4 drum kits (electronic, acoustic, wood blocks, congas), 6 pieces each.
- Two big pickers at the bottom of the screen, Song Maker style: one for the
  melody instrument and one for the drum kit, each with its own icon and a
  preview of the sound as you choose. They act on the selected track, and
  create the track for you if the song has none of that kind yet.
- Master effects: reverb with adjustable room size, tempo-synced delay, tone,
  warmth (saturation), stereo width, plus a compressor on the output.
- Swing and humanise, so a grid doesn't have to sound like a grid.

**Structure**

- 14 scales (major, minor, harmonic minor, two pentatonics, blues, four modes,
  hirajoshi, arabic, whole tone, chromatic) in any key, 1–4 octaves.
- 1–16 bars, 1–12 beats per bar, beats split into halves, triplets, quarters or
  sixths.
- **8 patterns** per song, chained into an arrangement — switch the transport
  from *Loop* to *Song* to play the whole thing.
- **✨ Generate** writes a part for the selected track: Euclidean beats, four on
  the floor, arpeggios, chord progressions, basslines, melodies, sparkle.

**Getting music in and out**

- **Record** from your microphone (it tracks your pitch and snaps it to the
  scale), from a MIDI keyboard, or by tapping the home-row keys in time.
- Export **.wav** (rendered offline, faster than real time), **.mid** (one MIDI
  track per part, with program changes and GM drum mapping), or **.json**.
- **Share links** hold the entire song in the URL — nothing is uploaded.
- Autosave, plus named save slots in the browser.
- 7 themes, light and dark. Works on phones and tablets.

## Keyboard

| Key | |
|---|---|
| <kbd>Space</kbd> / <kbd>Enter</kbd> | play-pause / stop |
| <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> | draw / erase / select |
| <kbd>A</kbd>…<kbd>;</kbd> | play the scale live (<kbd>Shift</kbd> for the register above) |
| <kbd>[</kbd> <kbd>]</kbd> | previous / next pattern |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | undo / redo |
| <kbd>Ctrl</kbd>+<kbd>C</kbd> <kbd>V</kbd> <kbd>X</kbd> <kbd>A</kbd> | copy / paste / cut / select all |
| arrows | move the selection in pitch and time |
| <kbd>R</kbd> <kbd>T</kbd> <kbd>P</kbd> | record / add track / metronome |
| <kbd>O</kbd> <kbd>I</kbd> <kbd>E</kbd> <kbd>?</kbd> | options / mixer / share / help |
| <kbd>Ctrl</kbd>+wheel, <kbd>+</kbd> <kbd>−</kbd> | zoom the grid |

## Run it locally

```bash
git clone https://github.com/ZDStudios/music-lab.git
cd music-lab
npm start            # → http://localhost:5173
```

There is nothing to compile — `src/` is plain ES modules. Any static file
server works.

## Desktop build

The desktop app is the same code in an Electron shell, with a native Save-As
dialog for exports.

```bash
npm install
npm run dist:win     # → dist/MusicLabStudio-1.0.0-x64.exe (installer)
                     #   dist/MusicLabStudio-1.0.0-portable.exe (no install)
npm run dist:mac     # → dist/*.dmg
npm run dist:linux   # → dist/*.AppImage
```

Building a Windows installer is only fully supported **on Windows**. If you are
on macOS or Linux, use the GitHub Action instead: **Actions → Build desktop
apps → Run workflow**. It builds all three platforms and uploads the `.exe`,
`.dmg` and `.AppImage` as artifacts. Pushing a tag (`git tag v1.0.0 && git push
--tags`) also attaches them to a release.

`npm run electron` runs the desktop app locally without packaging.

> If you just want something that runs offline with no install at all, use
> `offline.html` — one file, double-click it, done.

## How it is put together

```
index.html               markup for the whole UI
src/
  main.js                app wiring: transport, shortcuts, recording, export
  core/
    project.js           the song model, instruments, kits, (de)serialisation
    state.js             store with snapshot-based undo/redo
    scales.js            scales, the pitch ladder, note colours
    generate.js          the ✨ Generate part writers
    storage.js           save slots, autosave, share-link packing
    midi.js              MIDI file export + Web MIDI input
  audio/
    instruments.js       every voice, synthesised from oscillators and noise
    engine.js            audio graph (Rig) and step scheduler (Transport)
    render.js            offline render → .wav
    mic.js               autocorrelation pitch detection
  ui/
    grid.js              the virtualised canvas grid
    rail.js              track list
    panels.js            settings, mixer, share
    icons.js             instrument pictograms
    popover.js  toast.js
electron/                desktop shell (main + preload)
scripts/
  serve.mjs              dev server
  bundle-standalone.mjs  inlines everything into one HTML file
  make-icon.mjs          draws the app icon from code
```

The grid is a single canvas that only draws the cells currently on screen, so
long songs with many tracks stay smooth. `Rig` is deliberately
context-agnostic: the same graph code runs on an `AudioContext` for playback and
on an `OfflineAudioContext` for export.

## Notes on the audio

Everything is synthesis — there are no samples anywhere in the repo. Marimba is
a sine with a fast decay plus a 4th-harmonic ping; music box is 2-operator FM;
strings are detuned saws with vibrato; the 808-ish kick is a pitch-dropping sine
with a noise transient. Reverb is a procedurally generated impulse response, so
even that is a few lines of maths rather than a file to download.

## Licence

MIT.
