import { type ChangeEvent, useEffect, useRef } from 'react'
import { AvatarCanvas, CanvasErrorBoundary } from './components/avatar/AvatarCanvas'
import { ConnectionDrawer } from './components/drawers/ConnectionDrawer'
import { DiagnosticsDrawer } from './components/drawers/DiagnosticsDrawer'
import { LogsDrawer } from './components/drawers/LogsDrawer'
import { PersonaDrawer } from './components/drawers/PersonaDrawer'
import { RemotePanel } from './components/panels/RemotePanel'
import { StreamPanel } from './components/panels/StreamPanel'
import { ControlDock } from './components/session/ControlDock'
import { useAppStore } from './store/appStore'
import './App.css'

const isMobileViewport = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches

function App() {
  const vrmFileInputRef = useRef<HTMLInputElement | null>(null)
  const vrmUrl = useAppStore((s) => s.vrmUrl)
  const cameraResetKey = useAppStore((s) => s.cameraResetKey)
  const mouthOpen = useAppStore((s) => Math.min(1, Math.max(s.audioMouth, s.avatarMouth)))
  const appendLog = useAppStore((s) => s.appendLog)
  const updateVrmUrl = useAppStore((s) => s.updateVrmUrl)
  const setAvatarName = useAppStore((s) => s.setAvatarName)
  const setIsMobile = useAppStore((s) => s.setIsMobile)
  const loadCharacters = useAppStore((s) => s.loadCharacters)
  const loadSystemPrompts = useAppStore((s) => s.loadSystemPrompts)
  const micSupported = useAppStore((s) => s.micSupported)
  const decayAvatarMouth = useAppStore((s) => s.decayAvatarMouth)
  const cleanup = useAppStore((s) => s.cleanup)

  useEffect(() => {
    const timer = setInterval(decayAvatarMouth, 90)
    return () => clearInterval(timer)
  }, [decayAvatarMouth])

  useEffect(() => {
    const handleResize = () => setIsMobile(isMobileViewport())
    handleResize()
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleResize)
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handleResize)
      }
    }
  }, [setIsMobile])

  useEffect(() => {
    void loadCharacters()
    void loadSystemPrompts()
  }, [loadCharacters, loadSystemPrompts])

  useEffect(() => {
    if (!micSupported) {
      const hint =
        typeof window !== 'undefined' && !window.isSecureContext
          ? 'secure context ではないためマイク API が無効です（HTTPS または localhost で開いてください）'
          : 'ブラウザがマイク API をサポートしていません'
      appendLog(`mic unsupported: ${hint}`)
    }
  }, [appendLog, micSupported])

  useEffect(() => cleanup, [cleanup])

  const handleVrmFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const objectUrl = URL.createObjectURL(file)
      updateVrmUrl(objectUrl, { isLocal: true })
      appendLog(`vrm: ローカルファイルを読み込み (${file.name})`)
    }
    event.target.value = ''
  }

  const openVrmFilePicker = () => {
    vrmFileInputRef.current?.click()
  }

  return (
    <div className="scene-shell">
      <div className="scene-canvas">
        <CanvasErrorBoundary resetKey={vrmUrl} onError={(err) => appendLog(`vrm load error: ${err.message}`)}>
          <AvatarCanvas key={vrmUrl} url={vrmUrl} mouthOpen={mouthOpen} onLoaded={setAvatarName} recenterKey={cameraResetKey} />
        </CanvasErrorBoundary>
      </div>

      <ControlDock />

      <RemotePanel vrmFileInputRef={vrmFileInputRef} onOpenVrmFilePicker={openVrmFilePicker} onVrmFileChange={handleVrmFileChange} />

      <StreamPanel />

      <div className="ui-overlay">
        <div className="drawer-stack">
          <ConnectionDrawer />
          <PersonaDrawer />
          <DiagnosticsDrawer />
          <LogsDrawer />
        </div>
      </div>
    </div>
  )
}

export default App
