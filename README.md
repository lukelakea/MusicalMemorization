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

**Export backup** writes a JSON file of everything except the audio and video
themselves: track and dance details, bookmarks, notes, scenes, lines and
characters. This is also how two devices (say a PC and a phone) stay in step.

**Import backup** merges a backup into this device rather than replacing it:

- You see what will change first: what gets added, updated, kept or removed.
- Something only one device has is kept. Where both have a different version, the
  one edited more recently wins, item by item.
- Deletions carry over: something deleted on the other device is removed here too,
  unless it was edited here after it was deleted there.
- **Undo import** puts the device back as it was just before the last import.
- Bookmarks and notes match their track by its original file name, so add the same
  audio file on each device and they attach to it.
- Device voices stay per device (natural voices carry over), and deleting a track or dance only affects this device.

Backups from before edit times were tracked can't carry deletions, and where both
devices differ the backup's version is used.

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

### Voices

Two kinds, both picked per character or per line:

- **Natural voices** (American and British, men and women) run on this device
  using the Kokoro voice model. The first use downloads the model (about 90 MB,
  once). Each line's audio is made once and saved, so it then plays instantly;
  **Speed** speeds up the saved audio without changing its pitch, so it never
  needs remaking. **Prepare voices** on a scene makes every line ahead of
  rehearsal. A line that isn't ready yet is read by the system voice and made in
  the background for next time. Editing a line's text remakes only that line.
  Natural voices sound the same everywhere, so a character's natural voice
  carries over in a backup, and so does the saved audio: prepare scenes on a
  fast computer, export, and the phone plays them without preparing anything.
  The audio is stored compressed (Opus), roughly 3 KB per second of speech.
- **This device's voices** come from the browser's own speech synthesis. On
  Windows, Chrome or Edge give a good set; on Android, Chrome plays the phone's
  one default voice whichever is picked.

Nothing is sent anywhere to produce either kind.
