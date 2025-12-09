import type { LogEntry } from '../../types/app'

type LogsDrawerProps = { open: boolean; logs: LogEntry[]; onClose: () => void }

export function LogsDrawer({ open, logs, onClose }: LogsDrawerProps) {
  if (!open) return null

  return (
    <div className="drawer-card log-drawer log">
      <div className="drawer-head">
        <div>
          <div className="eyebrow">Events</div>
          <h3>WS / オーディオログ</h3>
        </div>
        <div className="drawer-head-actions">
          <div className="pill pill-soft">max 80 entries</div>
          <button className="ghost" onClick={onClose}>
            収納
          </button>
        </div>
      </div>
      <ul>
        {logs
          .slice()
          .reverse()
          .map((entry, idx) => (
            <li key={idx}>
              <span className="time">{entry.time}</span>
              <span className="text">{entry.text}</span>
            </li>
          ))}
      </ul>
    </div>
  )
}
