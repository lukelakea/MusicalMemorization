import { useEffect, useRef, useState } from 'react'
import { ImportReview, UndoImportDialog } from './backup/ImportReview'
import {
  applyMerge,
  exportBackup,
  getImportSnapshot,
  readLocalData,
  requestPersistence,
  undoLastImport,
  type ImportSnapshot,
} from './lib/db'
import { BACKUP_VERSION, lastLocalEdit, planMerge, type LocalData, type MergePlan } from './lib/merge'
import { loadVoices } from './lib/speech'
import type { BackupFile } from './lib/types'
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
import { VoiceLabPage } from './voicelab/VoiceLabPage'

type Tab = 'tracks' | 'dance' | 'scenes' | 'mylines' | 'characters'

/** A backup that has been read and merged on paper, waiting to be confirmed. */
interface PendingImport {
  fileName: string
  backup: BackupFile
  /** This device's data the plan was made from; saved as the undo snapshot. */
  local: LocalData
  plan: MergePlan
}

export function App() {
  // The voice lab is a test bench, reached only by its link (#voice-lab).
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
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
  function openTab(next: Tab) {
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search)
    setHash('')
    setTab(next)
  }
  const importInput = useRef<HTMLInputElement>(null)
  const [review, setReview] = useState<PendingImport | null>(null)
  const [snapshot, setSnapshot] = useState<ImportSnapshot | undefined>()
  const [undoing, setUndoing] = useState(false)
  // Bumped after an import or undo; keys the pages so they reload from the database.
  const [dataVersion, setDataVersion] = useState(0)

  useEffect(() => {
    void requestPersistence()
    void getImportSnapshot().then(setSnapshot)
  }, [])

  async function doExport() {
    const backup = await exportBackup()
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    // Local date and time, so several exports on one day don't all share a
    // name and end up as easily-confused "(1)", "(2)" copies.
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}`
    link.href = url
    link.download = `musical-memorization-${stamp}.json`
    link.click()
    // The browser reads the blob asynchronously after the click; revoking
    // immediately cancels the download.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  /** Reads a backup and works out the merge; nothing is written until it's confirmed. */
  async function doImport(file: File | undefined) {
    if (!file) return
    try {
      let backup: BackupFile
      try {
        backup = JSON.parse(await file.text())
      } catch {
        throw new Error('Not a Musical Memorization backup file.')
      }
      if (backup?.format !== 'musical-memorization') {
        throw new Error('Not a Musical Memorization backup file.')
      }
      if (backup.version > BACKUP_VERSION) {
        throw new Error(
          'This backup comes from a newer version of the app. Close and reopen the app to update it, then import again.',
        )
      }
      // Voice ids belong to the device that picked them, so the merge needs to
      // know which voices exist here to decide whether a backup's voice is usable.
      const voices = await loadVoices()
      const knownVoiceIds = new Set(voices.flatMap((v) => [v.id, ...v.alternateIds]))
      const local = await readLocalData()
      setReview({
        fileName: file.name,
        backup,
        local,
        plan: planMerge(local, backup, knownVoiceIds),
      })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Import failed.')
    } finally {
      if (importInput.current) importInput.current.value = ''
    }
  }

  async function confirmImport() {
    if (!review) return
    try {
      await applyMerge(review.plan, review.local, review.fileName)
      const { summary } = review.plan
      setStatus(
        `Imported ${review.fileName}: ${summary.added.length} added, ${summary.replaced.length} updated, ` +
          `${summary.removed.length} removed, ${summary.keptLocal.length} kept as they were here.`,
      )
      setSnapshot(await getImportSnapshot())
      // Remount the pages so none of them keeps showing — and later saves —
      // the data as it was before the import.
      setDataVersion((version) => version + 1)
    } catch (error) {
      setStatus(error instanceof Error ? `Import failed: ${error.message}` : 'Import failed.')
    } finally {
      setReview(null)
    }
  }

  async function confirmUndo() {
    try {
      await undoLastImport()
      setStatus('Undid the last import.')
      setSnapshot(undefined)
      setDataVersion((version) => version + 1)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Undo failed.')
    } finally {
      setUndoing(false)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Musical Memorization</h1>
        <nav className="tabs">
          <button
            className={tab === 'tracks' ? 'is-active' : ''}
            onClick={() => openTab('tracks')}
          >
            Tracks
          </button>
          <button
            className={tab === 'dance' ? 'is-active' : ''}
            onClick={() => openTab('dance')}
          >
            Dance
          </button>
          <button
            className={tab === 'scenes' ? 'is-active' : ''}
            onClick={() => openTab('scenes')}
          >
            Scenes
          </button>
          <button
            className={tab === 'mylines' ? 'is-active' : ''}
            onClick={() => openTab('mylines')}
          >
            My Lines
          </button>
          <button
            className={tab === 'characters' ? 'is-active' : ''}
            onClick={() => openTab('characters')}
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
          {snapshot && (
            <button className="ghost" onClick={() => setUndoing(true)}>
              Undo import
            </button>
          )}
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

      {review && (
        <ImportReview
          fileName={review.fileName}
          plan={review.plan}
          backupVersion={review.backup.version}
          exportedAt={review.backup.exportedAt}
          lastLocalEdit={lastLocalEdit(review.local)}
          onConfirm={confirmImport}
          onCancel={() => setReview(null)}
        />
      )}
      {undoing && snapshot && (
        <UndoImportDialog
          fileName={snapshot.fileName}
          takenAt={snapshot.takenAt}
          onConfirm={confirmUndo}
          onCancel={() => setUndoing(false)}
        />
      )}

      <main key={dataVersion}>
        {hash === '#voice-lab' ? (
          <VoiceLabPage />
        ) : tab === 'tracks' ? (
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
