import { useEffect, useRef, useState } from 'react'
import { exportBackup, importBackup, requestPersistence } from './lib/db'
import { loadVoices } from './lib/speech'
import { CharactersPage } from './characters/CharactersPage'
import { DancePage } from './dance/DancePage'
import { MyLinesPage } from './mylines/MyLinesPage'
import {
  loadPlaybackSettings,
  savePlaybackSettings,
  type PlaybackSettings,
} from './scenes/playbackSettings'
import { ScenesPage } from './scenes/ScenesPage'
import { TracksPage } from './tracks/TracksPage'

type Tab = 'tracks' | 'dance' | 'scenes' | 'mylines' | 'characters'

export function App() {
  const [tab, setTab] = useState<Tab>('tracks')
  const [status, setStatus] = useState<string | null>(null)
  // Held here, above the pages, so speed and delay survive switching tabs.
  const [settings, setSettings] = useState<PlaybackSettings>(loadPlaybackSettings)
  const updateSettings = (patch: Partial<PlaybackSettings>) =>
    setSettings((current) => {
      const next = { ...current, ...patch }
      savePlaybackSettings(next)
      return next
    })
  const importInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void requestPersistence()
  }, [])

  async function doExport() {
    const backup = await exportBackup()
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    link.href = url
    link.download = `musical-memorization-${stamp}.json`
    link.click()
    // The browser reads the blob asynchronously after the click; revoking
    // immediately cancels the download.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  async function doImport(file: File | undefined) {
    if (!file) return
    try {
      // Voice ids belong to the device that picked them, so the import needs to
      // know which voices exist here to decide whether a backup's voice is usable.
      const voices = await loadVoices()
      const knownVoiceIds = new Set(voices.flatMap((v) => [v.id, ...v.alternateIds]))
      const result = await importBackup(JSON.parse(await file.text()), knownVoiceIds)
      setStatus(
        `Imported ${result.bookmarksAdded} bookmark(s), ` +
          `${result.scenesAdded} scene(s), ${result.linesAdded} line(s), ` +
          `${result.notesAdded} note(s), ${result.charactersAdded} character(s), renamed ${result.namesUpdated} track(s).` +
          (result.bookmarksSkipped
            ? ` Skipped ${result.bookmarksSkipped} bookmark(s) whose track is not imported here yet.`
            : '') +
          (result.danceBookmarksAdded || result.danceNotesAdded || result.dancesUpdated
            ? ` Dance: ${result.danceBookmarksAdded} bookmark(s), ${result.danceNotesAdded} note(s), updated ${result.dancesUpdated} dance(s).`
            : '') +
          (result.danceBookmarksSkipped
            ? ` Skipped ${result.danceBookmarksSkipped} dance bookmark(s) whose video is not imported here yet.`
            : ''),
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Import failed.')
    } finally {
      if (importInput.current) importInput.current.value = ''
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Musical Memorization</h1>
        <nav className="tabs">
          <button
            className={tab === 'tracks' ? 'is-active' : ''}
            onClick={() => setTab('tracks')}
          >
            Tracks
          </button>
          <button
            className={tab === 'dance' ? 'is-active' : ''}
            onClick={() => setTab('dance')}
          >
            Dance
          </button>
          <button
            className={tab === 'scenes' ? 'is-active' : ''}
            onClick={() => setTab('scenes')}
          >
            Scenes
          </button>
          <button
            className={tab === 'mylines' ? 'is-active' : ''}
            onClick={() => setTab('mylines')}
          >
            My Lines
          </button>
          <button
            className={tab === 'characters' ? 'is-active' : ''}
            onClick={() => setTab('characters')}
          >
            Characters
          </button>
        </nav>
        <div className="backup">
          <button className="ghost" onClick={() => void doExport()}>
            Export backup
          </button>
          <button className="ghost" onClick={() => importInput.current?.click()}>
            Import backup
          </button>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => void doImport(e.target.files?.[0])}
          />
        </div>
      </header>

      {status && (
        <div className="status" onClick={() => setStatus(null)}>
          {status} <span className="dismiss">dismiss</span>
        </div>
      )}

      <main>
        {tab === 'tracks' ? (
          <TracksPage />
        ) : tab === 'dance' ? (
          <DancePage />
        ) : tab === 'scenes' ? (
          <ScenesPage settings={settings} onSettingsChange={updateSettings} />
        ) : tab === 'mylines' ? (
          <MyLinesPage settings={settings} onSettingsChange={updateSettings} />
        ) : (
          <CharactersPage />
        )}
      </main>
    </div>
  )
}
