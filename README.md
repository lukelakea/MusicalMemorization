# Musical Memorization

A private, local-first rehearsal aid. Everything stays in this browser — no server,
no accounts, nothing uploaded.

## Run it

```
npm install
npm run dev
```

Vite prints a `Network:` URL as well as the local one, so the app can be opened
from a phone on the same Wi-Fi.

## Tracks (built)

Import cast recordings and rehearsal tracks once — they are stored in IndexedDB,
so they are still there after a reload.

- **+ Add at 0:00.0** drops a bookmark at the current playhead. Name it, nudge the
  time by ±0.1s / ±1s, or snap it to wherever the playhead is now.
- **Loop A–B** — give a bookmark an end time and it repeats that passage until you
  own it.
- **Speed** 0.5×–1.25× with pitch preserved, per bookmark or live.
- Keys **1**–**9** jump to a bookmark, **space** is play/pause. Bookmarks share one
  audio element, so a new one always replaces playback rather than layering on it.

Bookmarks belong to a single track and are deleted with it.

## Backups

**Export backup** writes a JSON file of every track's metadata, bookmarks, scenes
and lines (not the audio itself). **Import backup** merges one back in: bookmarks
match their track by id and then by name, so re-import an audio file under its old
name and its bookmarks reattach. Scenes are always added, never overwritten.

## Scenes

Script and lyric memorization. Add scenes, reorder them, and fill each with lines
you type in or paste.

- **Paste script** splits a pasted block on `SPEAKER: line`. A line with no name
  attached continues the one above it, so wrapped dialogue stays in one piece.
- Every line has a **mode**: *Read aloud* (a voice speaks it), *My line* (silence
  long enough for you to say it — auto-sized from the word count, or set a Hold),
  or *Silent note* (shown, never spoken — stage directions).
- Per line: voice, rate, pitch, and a **Delay** of silence after it.
- **On** disables a line without deleting it; the player skips it.
- **Speed** scales every voice and every pause in the scene at once, on top of the
  per-line rates.
- **Cue mode** blurs your own lines so you have to recall them, with a Peek button.
- Play / Pause / Stop / Prev / Next, or ▶ on any line to start from there. Pausing
  mid-line restarts that line rather than resuming halfway through it.

Voices come from the browser's own speech synthesis (Chrome or Edge on desktop
give the best set on Windows). Nothing is sent anywhere to produce them.
