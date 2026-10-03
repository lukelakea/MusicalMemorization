import { useEffect, useState } from 'react'
import type { Character, Scene } from '../lib/types'
import type { VoiceOption } from '../lib/speech'
import { loadVoices } from '../lib/speech'
import { deleteScene, getAllLines, getCharacters, getScenes, newId, putScene, reorder } from '../lib/db'
import { SceneEditor, type PlaybackSettings } from './SceneEditor'

export function ScenesPage() {
  const [scenes, setScenes] = useState<Scene[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  // Count of "My line" entries, shown as a small badge next to each scene in
  // the list. Loaded in bulk up front, then kept current for the open scene
  // as its lines are edited.
  const [myLineCounts, setMyLineCounts] = useState<Record<string, number>>({})
  const [settings, setSettings] = useState<PlaybackSettings>({
    speed: 1,
    delaySec: 0.8,
    speakMyLines: false,
    cueMode: false,
    autoAdvance: false,
  })
  // Set when a finished scene hands over to the next one, so that scene starts itself.
  const [autoPlayId, setAutoPlayId] = useState<string | null>(null)

  useEffect(() => {
    getScenes().then((loaded) => {
      setScenes(loaded)
      setSelectedId((current) => current ?? loaded[0]?.id ?? null)
    })
    getCharacters().then(setCharacters)
    loadVoices().then(setVoices)
    getAllLines().then((allLines) => {
      const counts: Record<string, number> = {}
      for (const line of allLines) {
        if (line.mode !== 'mine') continue
        counts[line.sceneId] = (counts[line.sceneId] ?? 0) + 1
      }
      setMyLineCounts(counts)
    })
  }, [])

  // Picking a scene by hand must never trigger a leftover auto-start.
  function selectScene(id: string | null) {
    setAutoPlayId(null)
    setSelectedId(id)
  }

  function sceneFinished(id: string) {
    if (!settings.autoAdvance) return
    const next = scenes[scenes.findIndex((scene) => scene.id === id) + 1]
    if (!next) return
    setAutoPlayId(next.id)
    setSelectedId(next.id)
  }

  const selected = scenes.find((scene) => scene.id === selectedId) ?? null

  async function addScene() {
    const scene: Scene = {
      id: newId(),
      title: `Scene ${scenes.length + 1}`,
      order: scenes.length,
      createdAt: Date.now(),
    }
    await putScene(scene)
    setScenes(await getScenes())
    selectScene(scene.id)
  }

  async function renameScene(id: string, title: string) {
    const scene = scenes.find((item) => item.id === id)
    if (!scene) return
    const updated = { ...scene, title }
    setScenes((current) => current.map((item) => (item.id === id ? updated : item)))
    await putScene(updated)
  }

  async function moveScene(id: string, direction: -1 | 1) {
    const next = reorder(scenes, id, direction)
    setScenes(next)
    await Promise.all(next.map((scene) => putScene(scene)))
  }

  async function removeScene(id: string) {
    await deleteScene(id)
    const remaining = (await getScenes()).map((scene, index) => ({ ...scene, order: index }))
    await Promise.all(remaining.map((scene) => putScene(scene)))
    setScenes(remaining)
    if (selectedId === id) selectScene(remaining[0]?.id ?? null)
  }

  return (
    <div className="tracks-page">
      <aside className="track-list">
        <div className="track-list-header">
          <h2>Scenes</h2>
          <button className="primary" onClick={() => void addScene()}>
            Add scene
          </button>
        </div>

        {scenes.length === 0 ? (
          <p className="empty">
            No scenes yet. Add one, then type or paste the lines you need to learn.
          </p>
        ) : (
          <ul>
            {scenes.map((scene, index) => (
              <li key={scene.id} className="scene-item-row">
                <button
                  className={`track-item ${scene.id === selectedId ? 'is-selected' : ''}`}
                  onClick={() => selectScene(scene.id)}
                >
                  <span className="track-item-name">{scene.title}</span>
                  {myLineCounts[scene.id] > 0 && (
                    <span className="track-item-time" title="My lines in this scene">
                      {myLineCounts[scene.id]}
                    </span>
                  )}
                </button>
                <div className="line-move">
                  <button
                    className="ghost tiny"
                    disabled={index === 0}
                    onClick={() => void moveScene(scene.id, -1)}
                    title="Move up"
                  >
                    ▲
                  </button>
                  <button
                    className="ghost tiny"
                    disabled={index === scenes.length - 1}
                    onClick={() => void moveScene(scene.id, 1)}
                    title="Move down"
                  >
                    ▼
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {selected ? (
        <SceneEditor
          key={selected.id}
          scene={selected}
          voices={voices}
          characters={characters}
          settings={settings}
          onSettingsChange={(patch) => setSettings((current) => ({ ...current, ...patch }))}
          autoPlay={selected.id === autoPlayId}
          onFinished={() => sceneFinished(selected.id)}
          onRename={(title) => void renameScene(selected.id, title)}
          onDelete={() => void removeScene(selected.id)}
          onMyLineCountChange={(count) =>
            setMyLineCounts((current) =>
              current[selected.id] === count ? current : { ...current, [selected.id]: count },
            )
          }
        />
      ) : (
        <section className="player player-empty">
          <p className="empty">Select a scene to edit its lines.</p>
        </section>
      )}
    </div>
  )
}
