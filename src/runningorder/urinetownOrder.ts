import type { ShowNumber } from '../lib/types'

/** [number, title, page] for each entry of the score's musical-numbers list. */
const ACT_1: [string, string, number][] = [
  ['1', 'Prelude', 1],
  ['2', 'Urinetown', 1],
  ['3a', 'Privilege To Pee', 7],
  ['4', "Privilege To Pee (Lockstock's Reprise)", 13],
  ['4a', 'Intro Act 1, Scene 2', 14],
  ['4b', 'Staff Entrance', 17],
  ['5', 'Mr. Cladwell', 17],
  ['6', 'Cop Song', 23],
  ['6a', 'Apparitions', 30],
  ['7', 'Follow Your Heart', 31],
  ['7a', 'After Follow Your Heart', 35],
  ['8', 'Look At the Sky', 37],
  ['8a', 'Sky Playoff', 41],
  ['8b', 'Love Sting', 42],
  ['9', "Don't Be the Bunny", 44],
  ['9a', 'Sky Utility', 47],
  ['10', 'Act One Finale', 49],
]

const ACT_2: [string, string, number][] = [
  ['11', 'What Is Urinetown', 59],
  ['12', 'Snuff That Girl', 65],
  ['13', 'Run, Freedom, Run', 69],
  ['13a', 'Freedom Playoff', 73],
  ['14', 'Follow Your Heart Reprise', 77],
  ['14a', 'Follow Your Heart Scene Change', 77],
  ['15', 'Why Did I Listen To That Man', 80],
  ['15a', "After Bobby's Death", 86],
  ['16', 'Tell Her I Love Her', 88],
  ['17', "We're Not Sorry", 93],
  ['18', "I'm Not Sorry Reprise", 98],
  ['19', 'I See a River', 99],
  ['20', 'Bows', 103],
  ['20a', 'After "Bows" (What Is Urinetown)', 103],
  ['21', 'Exit Music', 103],
]

/**
 * The Urinetown running order. Ids are fixed, so loading it on two devices
 * produces the same records and a backup merge doesn't duplicate them.
 */
export function urinetownRunningOrder(): ShowNumber[] {
  const now = Date.now()
  const rows: [1 | 2, string, string, number][] = [
    ...ACT_1.map(([label, title, page]): [1 | 2, string, string, number] => [1, label, title, page]),
    ...ACT_2.map(([label, title, page]): [1 | 2, string, string, number] => [2, label, title, page]),
  ]
  return rows.map(([act, label, title, page], order) => ({
    id: `urinetown-${label}`,
    label,
    title,
    act,
    page,
    order,
    role: '',
    changeAfter: '',
    createdAt: now,
  }))
}
