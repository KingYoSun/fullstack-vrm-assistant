import type { WsState } from '../../types/app'

type ConnectionDrawerProps = {
  open: boolean
  wsUrl: string
  baseUrl: string
  sessionId: string
  vrmUrl: string
  state: WsState
  partial: string
  lastUserText: string
  lastAssistantText: string
  ttsBytes: number
  micActive: boolean
  micSupported: boolean
  defaultWsBaseUrl: string
  onClose: () => void
  onConnect: () => void
  onDisconnect: () => void
  onPing: () => void
  onFlush: () => void
  onResume: () => void
  onStartMic: () => void
  onStopMic: () => void
  onChangeBaseUrl: (value: string) => void
  onChangeSessionId: (value: string) => void
  onChangeVrmUrl: (value: string) => void
}

export function ConnectionDrawer({
  open,
  wsUrl,
  baseUrl,
  sessionId,
  vrmUrl,
  state,
  partial,
  lastUserText,
  lastAssistantText,
  ttsBytes,
  micActive,
  micSupported,
  defaultWsBaseUrl,
  onClose,
  onConnect,
  onDisconnect,
  onPing,
  onFlush,
  onResume,
  onStartMic,
  onStopMic,
  onChangeBaseUrl,
  onChangeSessionId,
  onChangeVrmUrl,
}: ConnectionDrawerProps) {
  if (!open) return null

  return (
    <div className="drawer-card controls-drawer">
      <div className="drawer-head">
        <div>
          <div className="eyebrow">接続とソース</div>
          <h3>WebSocket / VRM</h3>
          <p className="mono small ws-url">{wsUrl}</p>
        </div>
        <button className="ghost" onClick={onClose}>
          収納
        </button>
      </div>
      <div className="control-grid">
        <div className="field">
          <label>Base WS URL</label>
          <input value={baseUrl} onChange={(e) => onChangeBaseUrl(e.target.value)} placeholder={defaultWsBaseUrl} />
        </div>
        <div className="field">
          <label>Session ID</label>
          <input value={sessionId} onChange={(e) => onChangeSessionId(e.target.value)} />
        </div>
        <div className="field">
          <label>VRM URL</label>
          <input value={vrmUrl} onChange={(e) => onChangeVrmUrl(e.target.value)} placeholder="https://...vrm" />
        </div>
      </div>
      <div className="actions">
        <button onClick={onConnect} disabled={state === 'connected' || state === 'connecting'}>
          Connect
        </button>
        <button onClick={onDisconnect} disabled={state === 'disconnected'}>
          Disconnect
        </button>
        <button onClick={onPing} disabled={state !== 'connected'}>
          Ping
        </button>
        <button onClick={onFlush} disabled={state !== 'connected'}>
          Flush
        </button>
        <button onClick={onResume} disabled={state !== 'connected'}>
          Resume
        </button>
        <button onClick={onStartMic} disabled={state !== 'connected' || micActive || !micSupported}>
          録音開始
        </button>
        <button onClick={onStopMic} disabled={!micActive}>
          録音終了（送信）
        </button>
      </div>
      <div className="live-stats">
        <div className="stat-block">
          <div className="eyebrow">Partial</div>
          <p className="mono">{partial || '—'}</p>
        </div>
        <div className="stat-block">
          <div className="eyebrow">User (latest)</div>
          <p className="mono">{lastUserText || '—'}</p>
        </div>
        <div className="stat-block">
          <div className="eyebrow">Assistant stream</div>
          <p className="mono small">{lastAssistantText || '—'}</p>
        </div>
        <div className="stat-block">
          <div className="eyebrow">TTS bytes</div>
          <p className="mono">{ttsBytes}</p>
        </div>
      </div>
    </div>
  )
}
