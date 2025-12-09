import { Activity, ChevronDown, ChevronUp, History } from 'lucide-react'
import { useAppStore } from '../../store/appStore'

export function StreamPanel() {
  const isMobile = useAppStore((s) => s.isMobile)
  const streamCollapsed = useAppStore((s) => s.streamCollapsed)
  const historyOpen = useAppStore((s) => s.historyOpen)
  const showLatencyPanel = useAppStore((s) => s.showLatencyPanel)
  const partial = useAppStore((s) => s.partial)
  const chatTurns = useAppStore((s) => s.chatTurns)
  const latency = useAppStore((s) => s.latency)
  const toggleHistory = useAppStore((s) => s.toggleHistory)
  const toggleLatency = useAppStore((s) => s.toggleLatency)
  const toggleStreamCollapsed = useAppStore((s) => s.toggleStreamCollapsed)
  const latestTurn = chatTurns.at(-1)

  return (
    <div className={`stream-fab glass-panel ${streamCollapsed ? 'collapsed' : ''}`}>
      <div className="stream-head">
        {!isMobile ? (
          <div>
            <div className="eyebrow">STT / LLM</div>
          </div>
        ) : null}
        <div className="stream-actions">
          <button className="ghost compact" onClick={toggleHistory} disabled={streamCollapsed}>
            {isMobile ? <History size={18} /> : historyOpen ? 'history ▲' : 'history ▼'}
          </button>
          <button className="ghost compact" onClick={toggleLatency} disabled={streamCollapsed}>
            {isMobile ? <Activity size={18} /> : showLatencyPanel ? 'latency ▲' : 'latency ▼'}
          </button>
          <button className="ghost compact collapse-action" onClick={toggleStreamCollapsed}>
            {isMobile ? (streamCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />) : streamCollapsed ? '展開' : '収納'}
          </button>
        </div>
      </div>
      {!streamCollapsed ? (
        <>
          <div className="stream-mini">
            <div className="stream-row">
              <span className="label">partial</span>
              <p className="mono tiny text-ellipsis">{partial || '—'}</p>
            </div>
            <div className="stream-row">
              <span className="label">user</span>
              <p className="mono tiny text-ellipsis">{latestTurn?.userText || '—'}</p>
            </div>
            <div className="stream-row">
              <span className="label">assistant</span>
              <p className="mono tiny text-ellipsis assistant">{latestTurn?.assistantText || '—'}</p>
            </div>
          </div>
          {showLatencyPanel ? (
            <div className="latency-card mini">
              <div className="latency-grid">
                <div>
                  <span>STT</span>
                  <strong>{latency.stt ?? '—'}</strong>
                </div>
                <div>
                  <span>LLM</span>
                  <strong>{latency.llm ?? '—'}</strong>
                </div>
                <div>
                  <span>TTS</span>
                  <strong>{latency.tts ?? '—'}</strong>
                </div>
              </div>
            </div>
          ) : null}
          {historyOpen ? (
            <div className="history-list mini">
              {chatTurns
                .slice()
                .reverse()
                .map((turn) => (
                  <div key={turn.id} className="history-card">
                    <p className="mono tiny text-ellipsis">{turn.userText || '（user textなし）'}</p>
                    <p className="mono tiny text-ellipsis assistant">{turn.assistantText || '応答なし'}</p>
                  </div>
                ))}
              {!chatTurns.length ? <p className="hint tiny">履歴なし</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
