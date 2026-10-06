import { useModelStatus, usePendingCount } from './useNatural'

/** One line on what the natural voices are doing: downloading, working, or failed. */
export function NaturalStatus() {
  const status = useModelStatus()
  const pending = usePendingCount()
  if (status.state === 'loading') {
    return (
      <p className="hint natural-status">
        Loading natural voices
        {status.totalBytes > 0
          ? `: ${(status.loadedBytes / 1e6).toFixed(0)} of ${(status.totalBytes / 1e6).toFixed(0)} MB`
          : '…'}{' '}
        (once only; it&rsquo;s kept on this device after)
      </p>
    )
  }
  if (status.state === 'error') {
    return (
      <p className="hint natural-status lab-error">
        Natural voices couldn&rsquo;t load ({status.error}). The system voice is used instead;
        they&rsquo;ll try again next time.
      </p>
    )
  }
  if (pending > 0) {
    return (
      <p className="hint natural-status">
        Making natural voice audio: {pending} line{pending === 1 ? '' : 's'} to go…
      </p>
    )
  }
  return null
}
