import { useEffect, useRef, useState } from 'react'
import { exportBackup, importBackup, requestPersistence } from './lib/db'
import { ScenesPage } from './scenes/ScenesPage'
import { TracksPage } from './tracks/TracksPage'

type Tab = 'tracks' | 'scenes'

export function App() {
  const [tab, setTab] = useState<Tab>('tracks')
  const [status, setStatus] = useState<string | null>(null)
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
      const result = await importBackup(JSON.parse(await file.text()))
      setStatus(
        `Imported ${result.bookmarksAdded} bookmark(s), ` +
          `${result.scenesAdded} scene(s), ${result.linesAdded} line(s), ` +
          `${result.notesAdded} note(s).` +
          (result.bookmarksSkipped
            ? ` Skipped ${result.bookmarksSkipped} bookmark(s) whose track is not imported here yet.`
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
            className={tab === 'scenes' ? 'is-active' : ''}
            onClick={() => setTab('scenes')}
          >
            Scenes
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
        {tab === 'tracks' ? <TracksPage /> : <ScenesPage />}
      </main>
    </div>
  )
}
