import { Activity, Mic, MicOff, Plug, PlugZap } from 'lucide-react'
import { useAppStore } from '../../store/appStore'

export function ControlDock() {
  const state = useAppStore((s) => s.state)
  const micActive = useAppStore((s) => s.micActive)
  const micSupported = useAppStore((s) => s.micSupported)
  const isMobile = useAppStore((s) => s.isMobile)
  const avatarName = useAppStore((s) => s.avatarName)
  const connect = useAppStore((s) => s.connect)
  const disconnect = useAppStore((s) => s.disconnect)
  const startMic = useAppStore((s) => s.startMic)
  const stopMic = useAppStore((s) => s.stopMic)
  const incrementCameraResetKey = useAppStore((s) => s.incrementCameraResetKey)

  const isConnected = state === 'connected'
  const isConnecting = state === 'connecting'
  const canResetCamera = Boolean(avatarName)

  return (
    <div className="control-dock glass-panel">
      <div className="control-row">
        <button
          className={`icon-button ${isConnected ? 'active' : ''}`}
          onClick={isConnected ? disconnect : connect}
          disabled={isConnecting}
          aria-label={isConnected ? 'Disconnect' : 'Connect'}
        >
          {isConnected ? <Plug size={20} /> : <PlugZap size={20} />}
          {!isMobile ? <span>{isConnected ? 'Disconnect' : 'Connect'}</span> : null}
        </button>
        <button
          className={`icon-button ${micActive ? 'hot' : ''}`}
          onClick={micActive ? () => stopMic({ flush: true, reason: 'manual stop' }) : startMic}
          disabled={!isConnected || (!micActive && !micSupported)}
          aria-label={micActive ? '録音停止' : '録音開始'}
        >
          {micActive ? <MicOff size={20} /> : <Mic size={20} />}
          {!isMobile ? <span>{micActive ? '録音停止' : '録音開始'}</span> : null}
        </button>
        <button className="ghost control-aux" onClick={incrementCameraResetKey} disabled={!canResetCamera}>
          <Activity size={20} />
          {!isMobile ? <span>視点リセット</span> : null}
        </button>
        <span className={`pill control-pill state-${state}`} aria-label={`state-${state}`}>
          {isConnected ? <Plug size={20} /> : isConnecting ? <PlugZap size={20} /> : <Plug size={20} />}
          {!isMobile ? <span className="pill-label">{state}</span> : null}
        </span>
        <span className={`pill control-pill ${micActive ? 'pill-hot' : ''}`} aria-label={`mic-${micActive ? 'on' : 'off'}`}>
          {micActive ? <Mic size={20} /> : <MicOff size={20} />}
          {!isMobile ? <span className="pill-label">mic {micActive ? 'on' : 'off'}</span> : null}
        </span>
      </div>
    </div>
  )
}
