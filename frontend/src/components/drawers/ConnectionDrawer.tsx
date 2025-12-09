import { DEFAULTS, selectWsUrl, useAppStore } from '../../store/appStore'

export function ConnectionDrawer() {
  const open = useAppStore((s) => s.connectionDrawerOpen)
  const wsUrl = useAppStore(selectWsUrl)
  const baseUrl = useAppStore((s) => s.baseUrl)
  const sessionId = useAppStore((s) => s.sessionId)
  const vrmUrl = useAppStore((s) => s.vrmUrl)
  const state = useAppStore((s) => s.state)
  const partial = useAppStore((s) => s.partial)
  const chatTurns = useAppStore((s) => s.chatTurns)
  const ttsBytes = useAppStore((s) => s.ttsBytes)
  const micActive = useAppStore((s) => s.micActive)
  const micSupported = useAppStore((s) => s.micSupported)
  const setConnectionDrawerOpen = useAppStore((s) => s.setConnectionDrawerOpen)
  const connect = useAppStore((s) => s.connect)
  const disconnect = useAppStore((s) => s.disconnect)
  const sendControl = useAppStore((s) => s.sendControl)
  const startMic = useAppStore((s) => s.startMic)
  const stopMic = useAppStore((s) => s.stopMic)
  const setBaseUrl = useAppStore((s) => s.setBaseUrl)
  const setSessionId = useAppStore((s) => s.setSessionId)
  const updateVrmUrl = useAppStore((s) => s.updateVrmUrl)

  const lastTurn = chatTurns.at(-1)
  const lastUserText = lastTurn?.userText ?? '—'
  const lastAssistantText = lastTurn?.assistantText ?? '—'

  if (!open) return null

  return (
    <div className="drawer-card controls-drawer">
      <div className="drawer-head">
        <div>
          <div className="eyebrow">接続とソース</div>
          <h3>WebSocket / VRM</h3>
          <p className="mono small ws-url">{wsUrl}</p>
        </div>
        <button className="ghost" onClick={() => setConnectionDrawerOpen(false)}>
          収納
        </button>
      </div>
      <div className="control-grid">
        <div className="field">
          <label>Base WS URL</label>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={DEFAULTS.WS_BASE_URL} />
        </div>
        <div className="field">
          <label>Session ID</label>
          <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
        </div>
        <div className="field">
          <label>VRM URL</label>
          <input value={vrmUrl} onChange={(e) => updateVrmUrl(e.target.value)} placeholder="https://...vrm" />
        </div>
      </div>
      <div className="actions">
        <button onClick={connect} disabled={state === 'connected' || state === 'connecting'}>
          Connect
        </button>
        <button onClick={disconnect} disabled={state === 'disconnected'}>
          Disconnect
        </button>
        <button onClick={() => sendControl('ping')} disabled={state !== 'connected'}>
          Ping
        </button>
        <button onClick={() => sendControl('flush')} disabled={state !== 'connected'}>
          Flush
        </button>
        <button onClick={() => sendControl('resume')} disabled={state !== 'connected'}>
          Resume
        </button>
        <button onClick={startMic} disabled={state !== 'connected' || micActive || !micSupported}>
          録音開始
        </button>
        <button onClick={() => stopMic({ flush: true, reason: 'manual stop' })} disabled={!micActive}>
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
