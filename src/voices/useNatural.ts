import { useSyncExternalStore } from 'react'
import { getModelStatus, onNaturalChange, pendingKeys } from '../lib/natural'

/** The natural voice model's status, kept current as it downloads and works. */
export function useModelStatus() {
  return useSyncExternalStore(onNaturalChange, getModelStatus)
}

/** How many lines are waiting to be made or being made. */
export function usePendingCount() {
  return useSyncExternalStore(onNaturalChange, () => pendingKeys().size)
}
