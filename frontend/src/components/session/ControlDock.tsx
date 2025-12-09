import { Activity, Mic, MicOff, Plug, PlugZap } from 'lucide-react'
import type { WsState } from '../../types/app'

type ControlDockProps = {
  state: WsState
  micActive: boolean
  micSupported: boolean
  isMobile: boolean
  canResetCamera: boolean
  onConnect: () => void
  onDisconnect: () => void
  onStartMic: () => void
  onStopMic: () => void
  onResetCamera: () => void
}

export function ControlDock({
  state,
  micActive,
  micSupported,
  isMobile,
  canResetCamera,
  onConnect,
  onDisconnect,
  onStartMic,
  onStopMic,
  onResetCamera,
}: ControlDockProps) {
  const isConnected = state === 'connected'
  const isConnecting = state === 'connecting'

  return (
    <div className="control-dock glass-panel">
      <div className="control-row">
        <button
          className={`icon-button ${isConnected ? 'active' : ''}`}
          onClick={isConnected ? onDisconnect : onConnect}
          disabled={isConnecting}
          aria-label={isConnected ? 'Disconnect' : 'Connect'}
        >
          {isConnected ? <Plug size={20} /> : <PlugZap size={20} />}
          {!isMobile ? <span>{isConnected ? 'Disconnect' : 'Connect'}</span> : null}
        </button>
        <button
          className={`icon-button ${micActive ? 'hot' : ''}`}
          onClick={micActive ? onStopMic : onStartMic}
          disabled={!isConnected || (!micActive && !micSupported)}
          aria-label={micActive ? '録音停止' : '録音開始'}
        >
          {micActive ? <MicOff size={20} /> : <Mic size={20} />}
          {!isMobile ? <span>{micActive ? '録音停止' : '録音開始'}</span> : null}
        </button>
        <button className="ghost control-aux" onClick={onResetCamera} disabled={!canResetCamera}>
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
