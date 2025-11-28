import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type WsState = 'disconnected' | 'connecting' | 'connected'

type LogEntry = { time: string; text: string }

function App() {
  const [baseUrl, setBaseUrl] = useState('ws://localhost:8000/ws/session')
  const [sessionId, setSessionId] = useState('demo-session')
  const [state, setState] = useState<WsState>('disconnected')
  const [partial, setPartial] = useState('')
  const [finals, setFinals] = useState<string[]>([])
  const [llmTokens, setLlmTokens] = useState<string[]>([])
  const [ttsBytes, setTtsBytes] = useState(0)
  const [latency, setLatency] = useState<{ stt?: number; llm?: number; tts?: number }>({})
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [micActive, setMicActive] = useState(false)
  const [lastAudioUrl, setLastAudioUrl] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const ttsBuffersRef = useRef<Uint8Array[]>([])

  const wsUrl = useMemo(() => {
    const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
    return `${normalized}/${sessionId}`
  }, [baseUrl, sessionId])

  useEffect(() => {
    return () => {
      wsRef.current?.close()
    }
  }, [])

  const appendLog = (text: string) => {
    setLogs((prev) => {
      const next = [...prev, { time: new Date().toLocaleTimeString(), text }]
      return next.slice(-50)
    })
  }

  const connect = () => {
    if (state !== 'disconnected') return
    setState('connecting')
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setState('connected')
      appendLog(`connected: ${wsUrl}`)
    }
    ws.onclose = (event) => {
      setState('disconnected')
      appendLog(`closed (${event.code}): ${event.reason || 'no reason'}`)
      stopMic()
    }
    ws.onerror = () => {
      appendLog('websocket error')
    }
    ws.onmessage = (event) => {
      void handleMessage(event.data)
    }
  }

  const disconnect = () => {
    wsRef.current?.close()
    wsRef.current = null
    setState('disconnected')
    stopMic()
  }

  const sendControl = (type: 'ping' | 'flush' | 'resume') => {
    if (!wsRef.current || state !== 'connected') return
    wsRef.current.send(JSON.stringify({ type }))
  }

  const startMic = async () => {
    if (micActive || state !== 'connected') return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 })
      recorder.ondataavailable = async (event) => {
        if (!wsRef.current || state !== 'connected') return
        if (event.data && event.data.size > 0) {
          const buffer = await event.data.arrayBuffer()
          wsRef.current.send(buffer)
        }
      }
      recorder.start(100) // 100ms チャンクで送信
      mediaRecorderRef.current = recorder
      setMicActive(true)
      appendLog('mic started')
    } catch (err) {
      appendLog(`mic error: ${(err as Error).message}`)
    }
  }

  const stopMic = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop())
      mediaRecorderRef.current = null
      setMicActive(false)
      appendLog('mic stopped')
    }
  }

  const handleJson = (payload: any) => {
    const type = payload?.type
    switch (type) {
      case 'partial_transcript':
        setPartial(payload.text ?? '')
        break
      case 'final_transcript':
        setPartial('')
        setFinals((prev) => [...prev, payload.text ?? ''])
        setLlmTokens([])
        break
      case 'llm_token':
        setLlmTokens((prev) => [...prev, payload.token ?? ''])
        break
      case 'llm_done':
        appendLog(`llm_done turn=${payload.turn_id} text=${(payload.assistant_text ?? '').slice(0, 120)}`)
        if (payload.latency_ms) {
          setLatency((prev) => ({
            ...prev,
            stt: payload.latency_ms.stt ?? prev.stt,
            llm: payload.latency_ms.llm ?? prev.llm,
          }))
        }
        break
      case 'tts_start':
        setTtsBytes(0)
        ttsBuffersRef.current = []
        appendLog(`tts_start turn=${payload.turn_id}`)
        break
      case 'tts_end':
        appendLog(`tts_end turn=${payload.turn_id}`)
        playTtsBuffer()
        if (payload.latency_ms) {
          setLatency((prev) => ({
            ...prev,
            llm: payload.latency_ms.llm ?? prev.llm,
            tts: payload.latency_ms.tts ?? prev.tts,
          }))
        }
        break
      case 'avatar_event':
        // For now just log significant mouth_open values.
        if (typeof payload.mouth_open === 'number' && payload.mouth_open > 0.6) {
          appendLog(`avatar mouth_open=${payload.mouth_open}`)
        }
        break
      case 'error':
        appendLog(`error: ${payload.message} (recoverable=${payload.recoverable})`)
        break
      case 'pong':
        appendLog('pong')
        break
      default:
        appendLog(`message: ${JSON.stringify(payload)}`)
        break
    }
  }

  const handleMessage = async (data: unknown) => {
    if (typeof data === 'string') {
      try {
        const payload = JSON.parse(data)
        handleJson(payload)
      } catch (err) {
        appendLog(`text: ${data}`)
      }
      return
    }
    if (data instanceof Blob) {
      setTtsBytes((prev) => prev + data.size)
      appendLog(`received opus chunk: ${data.size} bytes`)
      ttsBuffersRef.current.push(new Uint8Array(await data.arrayBuffer()))
      return
    }
    if (data instanceof ArrayBuffer) {
      setTtsBytes((prev) => prev + data.byteLength)
      appendLog(`received opus chunk: ${data.byteLength} bytes`)
      ttsBuffersRef.current.push(new Uint8Array(data))
      return
    }
    appendLog('unknown message type')
  }

  const playTtsBuffer = async () => {
    const buffers = ttsBuffersRef.current
    if (!buffers.length) return
    const blob = new Blob(buffers.map((b) => new Uint8Array(b)), { type: 'audio/ogg; codecs=opus' })
    const url = URL.createObjectURL(blob)
    if (lastAudioUrl) {
      URL.revokeObjectURL(lastAudioUrl)
    }
    setLastAudioUrl(url)
    const audio = new Audio(url)
    audio.play().catch((err) => appendLog(`audio play error: ${err.message}`))
    ttsBuffersRef.current = []
  }

  const lastFinal = finals.at(-1) ?? ''
  const tokensJoined = llmTokens.join('')

  return (
    <div className="app">
      <header>
        <div>
          <div className="eyebrow">VRM Voice Assistant</div>
          <h1>WebSocket Session Console</h1>
          <p className="sub">
            Phase 3 着手用の最小 UI。接続後に Opus バイナリや JSON イベントが流れてくることを確認できます。
          </p>
        </div>
        <div className={`badge state-${state}`}>{state}</div>
      </header>

      <section className="panel">
        <div className="field">
          <label>Base WS URL</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="ws://localhost:8000/ws/session"
          />
        </div>
        <div className="field">
          <label>Session ID</label>
          <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
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
          <button onClick={startMic} disabled={state !== 'connected' || micActive}>
            Start Mic
          </button>
          <button onClick={stopMic} disabled={!micActive}>
            Stop Mic
          </button>
        </div>
        <div className="ws-url">WS: {wsUrl}</div>
      </section>

      <section className="grid">
        <div className="panel">
          <div className="eyebrow">Partial Transcript</div>
          <p className="mono">{partial || '—'}</p>
        </div>
        <div className="panel">
          <div className="eyebrow">Final Transcript (latest)</div>
          <p className="mono">{lastFinal || '—'}</p>
        </div>
        <div className="panel">
          <div className="eyebrow">LLM Tokens</div>
          <p className="mono small">{tokensJoined || '—'}</p>
        </div>
        <div className="panel stats">
          <div>
            <div className="eyebrow">TTS Bytes</div>
            <div className="stat">{ttsBytes}</div>
          </div>
          <div>
            <div className="eyebrow">Latency (ms)</div>
            <div className="latencies">
              <span>stt: {latency.stt ?? '—'}</span>
              <span>llm: {latency.llm ?? '—'}</span>
              <span>tts: {latency.tts ?? '—'}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="panel log">
        <div className="eyebrow">Events</div>
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
      </section>
    </div>
  )
}

export default App
