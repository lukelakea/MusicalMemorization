import { useState } from 'react'
import { BACKUP_VERSION, isEmptyPlan, type MergePlan } from '../lib/merge'

interface Props {
  fileName: string
  plan: MergePlan
  backupVersion: number
  exportedAt: number
  /** Latest edit or deletion on this device; 0 if nothing has an edit time yet. */
  lastLocalEdit: number
  /** Lines of natural voice audio in the backup that this device doesn't have. */
  newAudio: number
  onConfirm: () => Promise<void>
  onCancel: () => void
}

const when = (time: number) =>
  new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** Shows what an import will change on this device before anything is written. */
export function ImportReview({
  fileName,
  plan,
  backupVersion,
  exportedAt,
  lastLocalEdit,
  newAudio,
  onConfirm,
  onCancel,
}: Props) {
  const [busy, setBusy] = useState(false)
  const { summary } = plan
  const empty = isEmptyPlan(plan) && newAudio === 0
  const groups: [string, string[]][] = [
    ['Added', summary.added],
    ['Updated from the backup', summary.replaced],
    ["Kept this device's newer version", summary.keptLocal],
    ['Removed — deleted on the other device', summary.removed],
  ]

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="import-review-title">
        <h2 id="import-review-title">Import {fileName}?</h2>
        <p className="muted">Backup made {when(exportedAt)}.</p>

        {lastLocalEdit > exportedAt && (
          <p className="notice">
            This backup is older than your last edit on this device ({when(lastLocalEdit)}). That's
            fine: for each item the newer version wins. Check the lists below.
          </p>
        )}
        {backupVersion < BACKUP_VERSION && (
          <p className="notice">
            This backup comes from an older version of the app. It can't remove things deleted on
            the other device, and where both devices have a different version of something, the
            backup's version is used.
          </p>
        )}

        {empty ? (
          <p>Nothing to import: this device already has everything in this backup.</p>
        ) : (
          <div className="review-groups">
            {groups.map(([title, items]) =>
              items.length ? (
                <details key={title}>
                  <summary>
                    {title} <span className="muted">({items.length})</span>
                  </summary>
                  <ul>
                    {items.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </details>
              ) : null,
            )}
          </div>
        )}
        {newAudio > 0 && (
          <p>
            Natural voice audio for {newAudio} line{newAudio === 1 ? '' : 's'}, ready to play
            without preparing.
          </p>
        )}
        {summary.skipped > 0 && (
          <p className="muted">
            {summary.skipped} bookmark(s) or note(s) belong to tracks or dances that aren't on this
            device, so they're left out. Add those files here, then import again.
          </p>
        )}
        {!empty && (
          <p className="muted">You can undo this import afterwards.</p>
        )}

        <div className="modal-actions">
          <button className="ghost" onClick={onCancel} disabled={busy}>
            {empty ? 'Close' : 'Cancel'}
          </button>
          {!empty && (
            <button className="primary" onClick={() => void confirm()} disabled={busy}>
              Import
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface UndoProps {
  fileName: string
  takenAt: number
  onConfirm: () => Promise<void>
  onCancel: () => void
}

export function UndoImportDialog({ fileName, takenAt, onConfirm, onCancel }: UndoProps) {
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="undo-import-title">
        <h2 id="undo-import-title">Undo the last import?</h2>
        <p>
          This puts this device back the way it was just before {fileName} was imported (
          {when(takenAt)}). Anything you've changed since then is rolled back too.
        </p>
        <div className="modal-actions">
          <button className="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="danger" onClick={() => void confirm()} disabled={busy}>
            Undo import
          </button>
        </div>
      </div>
    </div>
  )
}
