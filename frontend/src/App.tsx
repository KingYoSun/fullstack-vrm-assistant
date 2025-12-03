import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useLoader } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import { GLTFLoader, type GLTF, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import './App.css'

type WsState = 'disconnected' | 'connecting' | 'connected'

type LogEntry = { time: string; text: string }

type ChatTurn = {
  id: string
  userText: string
  assistantText: string
  status: 'listening' | 'responding' | 'done'
  startedAt: number
}

type LatencyMap = { stt?: number; llm?: number; tts?: number }

const DEFAULT_VRM = '/AliciaSolid.vrm'
const DEFAULT_WS_PATH = '/ws/session'

const normalizePath = (path: string) => {
  if (!path) return DEFAULT_WS_PATH
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash
}

const resolveDefaultWsBaseUrl = () => {
  const explicitBase = import.meta.env.VITE_WS_BASE_URL
  if (explicitBase) return explicitBase

  const wsPath = normalizePath(import.meta.env.VITE_WS_PATH ?? DEFAULT_WS_PATH)
  const host =
    import.meta.env.VITE_BACKEND_HOST ||
    (typeof window !== 'undefined' && window.location.hostname) ||
    'localhost'
  const envPort = import.meta.env.VITE_BACKEND_PORT
  const port = envPort === '' ? '' : envPort ?? '8000'
  const protocol =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const portPart = port ? `:${port}` : ''

  return `${protocol}//${host}${portPart}${wsPath}`
}

const DEFAULT_WS_BASE_URL = resolveDefaultWsBaseUrl()

type CanvasErrorBoundaryProps = { resetKey?: string; onError?: (error: Error) => void; children: ReactNode }
type CanvasErrorBoundaryState = { error: Error | null }

class CanvasErrorBoundary extends Component<CanvasErrorBoundaryProps, CanvasErrorBoundaryState> {
  state: CanvasErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error)
  }

  componentDidUpdate(prevProps: CanvasErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="canvas-error">
          <div className="eyebrow">VRM 読み込みエラー</div>
          <p className="mono small">{this.state.error.message}</p>
          <button onClick={this.handleReset}>再試行</button>
        </div>
      )
    }
    return this.props.children
  }
}

type VrmModelProps = { url: string; mouthOpen: number; onLoaded?: (name: string) => void }

function VrmModel({ url, mouthOpen, onLoaded }: VrmModelProps) {
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.register((parser: GLTFParser) => new VRMLoaderPlugin(parser))
  }) as GLTF

  const vrm = useMemo(() => {
    const loaded = gltf.userData.vrm as VRM | undefined
    if (!loaded) return null
    VRMUtils.removeUnnecessaryJoints(loaded.scene)
    VRMUtils.removeUnnecessaryVertices(loaded.scene)
    loaded.scene.traverse((obj) => {
      obj.frustumCulled = false
    })
    return loaded
  }, [gltf])

  useEffect(() => {
    if (vrm && onLoaded) {
      const meta = vrm.meta
      const name = meta.metaVersion === '0' ? meta.title ?? 'VRM avatar' : meta.name ?? 'VRM avatar'
      onLoaded(name)
    }
  }, [onLoaded, vrm])

  useFrame((_, delta) => {
    if (!vrm) return
    const intensity = Math.min(1, Math.max(0, mouthOpen))
    vrm.expressionManager?.setValue('aa', intensity)
    vrm.expressionManager?.setValue('ih', intensity * 0.25)
    vrm.expressionManager?.update()
    vrm.update(delta)
  })

  return vrm ? <primitive object={vrm.scene} /> : null
}

type AvatarCanvasProps = { url: string; mouthOpen: number; onLoaded?: (name: string) => void }

function AvatarCanvas({ url, mouthOpen, onLoaded }: AvatarCanvasProps) {
  return (
    <Canvas camera={{ position: [0, 1.4, 2.4], fov: 28 }} shadows style={{ height: '100%', width: '100%' }}>
      <color attach="background" args={['#0b1021']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[2, 3, 2]} intensity={1.1} castShadow />
      <Suspense
        fallback={
          <Html center>
            <span className="loading">Loading VRM...</span>
          </Html>
        }
      >
        <VrmModel url={url} mouthOpen={mouthOpen} onLoaded={onLoaded} />
        <OrbitControls minDistance={1.5} maxDistance={3} />
      </Suspense>
    </Canvas>
  )
}

type ChatLogProps = { turns: ChatTurn[]; partial: string }

function ChatLog({ turns, partial }: ChatLogProps) {
  if (!turns.length && !partial) {
    return <div className="empty">まだメッセージがありません。マイクを開始してみてください。</div>
  }

  return (
    <div className="chat-log">
      {partial ? (
        <div className="chat-card live">
          <div className="chat-meta">
            <span className="pill pill-user">User</span>
            <span className="pill pill-live">listening</span>
          </div>
          <p className="chat-text mono">{partial}</p>
        </div>
      ) : null}
      {turns
        .slice()
        .reverse()
        .map((turn) => (
          <div key={turn.id} className="chat-card">
            <div className="chat-meta">
              <span className="pill pill-user">User</span>
              <span className={`pill status-${turn.status}`}>{turn.status}</span>
            </div>
            <p className="chat-text">{turn.userText || '（user textなし）'}</p>
            <div className="divider" />
            <div className="chat-meta">
              <span className="pill pill-assistant">Assistant</span>
              <span className="pill pill-soft">stream</span>
            </div>
            <p className="chat-text assistant">{turn.assistantText || '応答待ち...'}</p>
          </div>
        ))}
    </div>
  )
}

function App() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_WS_BASE_URL)
  const [sessionId, setSessionId] = useState('demo-session')
  const [vrmUrl, setVrmUrl] = useState(DEFAULT_VRM)
  const [state, setState] = useState<WsState>('disconnected')
  const [partial, setPartial] = useState('')
  const [latency, setLatency] = useState<LatencyMap>({})
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [micActive, setMicActive] = useState(false)
  const [ttsBytes, setTtsBytes] = useState(0)
  const [audioMouth, setAudioMouth] = useState(0)
  const [avatarMouth, setAvatarMouth] = useState(0)
  const [avatarName, setAvatarName] = useState<string | null>(null)
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const ttsBuffersRef = useRef<Uint8Array[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const mouthRafRef = useRef<number | null>(null)
  const currentTurnIdRef = useRef<string | null>(null)

  const wsUrl = useMemo(() => {
    const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
    return `${normalized}/${sessionId}`
  }, [baseUrl, sessionId])

  useEffect(() => {
    return () => {
      wsRef.current?.close()
      stopMic()
      stopAudioMeter()
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      setAvatarMouth((prev) => (prev > 0.01 ? prev * 0.9 : 0))
    }, 90)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    setAvatarName(null)
  }, [vrmUrl])

  const mouthOpen = useMemo(() => Math.min(1, Math.max(audioMouth, avatarMouth)), [audioMouth, avatarMouth])
  const latestTurn = chatTurns.at(-1)
  const lastUserText = latestTurn?.userText ?? '—'
  const lastAssistantText = latestTurn?.assistantText ?? '—'

  const appendLog = (text: string) => {
    setLogs((prev) => {
      const next = [...prev, { time: new Date().toLocaleTimeString(), text }]
      return next.slice(-80)
    })
  }

  const ensureTurnId = (turnId?: string) => {
    if (turnId) {
      currentTurnIdRef.current = turnId
      return turnId
    }
    if (!currentTurnIdRef.current) {
      currentTurnIdRef.current = crypto.randomUUID?.() ?? `turn-${Date.now()}`
    }
    return currentTurnIdRef.current
  }

  const upsertTurn = (turnId: string, build: (prev: ChatTurn | null) => ChatTurn) => {
    setChatTurns((prev) => {
      const idx = prev.findIndex((t) => t.id === turnId)
      const base = idx >= 0 ? prev[idx] : null
      const updated = build(base)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = updated
        return next
      }
      return [...prev, updated]
    })
  }

  const connect = () => {
    if (state !== 'disconnected') return
    setState('connecting')
    setPartial('')
    setChatTurns([])
    setAvatarMouth(0)
    setAudioMouth(0)
    setTtsBytes(0)
    ttsBuffersRef.current = []
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setState('connected')
      appendLog(`connected: ${wsUrl}`)
    }
    ws.onclose = (event) => {
      setState('disconnected')
      currentTurnIdRef.current = null
      appendLog(`closed (${event.code}): ${event.reason || 'no reason'}`)
      stopMic()
      stopAudioMeter()
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
    stopAudioMeter()
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
      recorder.start(100)
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

  const ensureAudioContext = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    await audioContextRef.current.resume()
    return audioContextRef.current
  }

  const stopAudioMeter = (haltSource = true) => {
    if (mouthRafRef.current !== null) {
      cancelAnimationFrame(mouthRafRef.current)
      mouthRafRef.current = null
    }
    if (haltSource && audioSourceRef.current) {
      try {
        audioSourceRef.current.stop()
      } catch {
        // noop
      }
      audioSourceRef.current.disconnect()
      audioSourceRef.current = null
    }
    setAudioMouth(0)
  }

  const playTtsBuffer = async () => {
    const buffers = ttsBuffersRef.current
    if (!buffers.length) return
    const blob = new Blob(buffers.map((b) => new Uint8Array(b)), { type: 'audio/ogg; codecs=opus' })
    ttsBuffersRef.current = []
    try {
      const ctx = await ensureAudioContext()
      const arrayBuffer = await blob.arrayBuffer()
      const decoded = await ctx.decodeAudioData(arrayBuffer)
      const source = ctx.createBufferSource()
      const analyser = analyserRef.current ?? ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.88
      analyserRef.current = analyser

      source.buffer = decoded
      source.connect(analyser)
      analyser.connect(ctx.destination)

      stopAudioMeter()
      audioSourceRef.current = source
      const dataArray = new Uint8Array(analyser.fftSize)

      const tick = () => {
        analyser.getByteTimeDomainData(dataArray)
        const rms =
          Math.sqrt(dataArray.reduce((sum, v) => sum + (v - 128) * (v - 128), 0) / dataArray.length) / 128
        const openness = Math.min(1, Math.max(0, (rms - 0.02) * 6))
        setAudioMouth((prev) => prev * 0.4 + openness * 0.6)
        mouthRafRef.current = requestAnimationFrame(tick)
      }

      tick()
      source.start()
      source.onended = () => {
        stopAudioMeter(false)
      }
    } catch (err) {
      appendLog(`audio decode error: ${(err as Error).message}`)
    }
  }

  const handleJson = (payload: any) => {
    const type = payload?.type
    switch (type) {
      case 'partial_transcript':
        setPartial(payload.text ?? '')
        break
      case 'final_transcript': {
        const turnId = ensureTurnId(payload.turn_id)
        setPartial('')
        upsertTurn(turnId, (prev) => ({
          id: turnId,
          userText: payload.text ?? prev?.userText ?? '',
          assistantText: prev?.assistantText ?? '',
          status: 'responding',
          startedAt: prev?.startedAt ?? Date.now(),
        }))
        if (payload.latency_ms?.stt) {
          setLatency((prev) => ({ ...prev, stt: payload.latency_ms.stt }))
        }
        break
      }
      case 'llm_token': {
        const turnId = ensureTurnId(payload.turn_id)
        const token = payload.token ?? ''
        upsertTurn(turnId, (prev) => ({
          id: turnId,
          userText: prev?.userText ?? '',
          assistantText: `${prev?.assistantText ?? ''}${token}`,
          status: 'responding',
          startedAt: prev?.startedAt ?? Date.now(),
        }))
        break
      }
      case 'llm_done': {
        const turnId = ensureTurnId(payload.turn_id)
        appendLog(`llm_done turn=${turnId} text=${(payload.assistant_text ?? '').slice(0, 120)}`)
        upsertTurn(turnId, (prev) => ({
          id: turnId,
          userText: prev?.userText ?? '',
          assistantText: payload.assistant_text ?? prev?.assistantText ?? '',
          status: 'done',
          startedAt: prev?.startedAt ?? Date.now(),
        }))
        if (payload.latency_ms) {
          setLatency((prev) => ({
            ...prev,
            stt: payload.latency_ms.stt ?? prev.stt,
            llm: payload.latency_ms.llm ?? prev.llm,
          }))
        }
        break
      }
      case 'tts_start':
        setTtsBytes(0)
        ttsBuffersRef.current = []
        appendLog(`tts_start turn=${payload.turn_id}`)
        break
      case 'tts_end':
        appendLog(`tts_end turn=${payload.turn_id}`)
        void playTtsBuffer()
        if (payload.latency_ms) {
          setLatency((prev) => ({
            ...prev,
            llm: payload.latency_ms.llm ?? prev.llm,
            tts: payload.latency_ms.tts ?? prev.tts,
          }))
        }
        break
      case 'avatar_event':
        if (typeof payload.mouth_open === 'number') {
          const openness = Math.min(1, Math.max(0, payload.mouth_open))
          setAvatarMouth((prev) => prev * 0.5 + openness * 0.5)
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
      } catch {
        appendLog(`text: ${data}`)
      }
      return
    }
    if (data instanceof Blob) {
      setTtsBytes((prev) => prev + data.size)
      ttsBuffersRef.current.push(new Uint8Array(await data.arrayBuffer()))
      return
    }
    if (data instanceof ArrayBuffer) {
      setTtsBytes((prev) => prev + data.byteLength)
      ttsBuffersRef.current.push(new Uint8Array(data))
      return
    }
    appendLog('unknown message type')
  }

  return (
    <div className="shell">
      <header className="hero">
        <div>
          <div className="eyebrow">VRM Voice Assistant</div>
          <h1>Phase 3 Frontend MVP</h1>
          <p className="sub">
            WebSocket ストリームと VRM をひとつの画面で確認できるデバッグ UI。音量ベースのリップシンクを含む。
          </p>
          <div className="hero-pills">
            <span className={`pill state-${state}`}>{state}</span>
            <span className={`pill ${micActive ? 'pill-hot' : ''}`}>mic {micActive ? 'on' : 'off'}</span>
            <span className="pill pill-soft">mouth {mouthOpen.toFixed(2)}</span>
          </div>
        </div>
        <div className="latency-card">
          <div className="eyebrow">Latency (ms)</div>
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
      </header>

      <section className="panel controls">
        <div className="section-head">
          <div>
            <div className="eyebrow">接続とソース</div>
            <h3>WebSocket / VRM</h3>
          </div>
          <div className="ws-url mono">{wsUrl}</div>
        </div>
        <div className="control-grid">
          <div className="field">
            <label>Base WS URL</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={DEFAULT_WS_BASE_URL}
            />
          </div>
          <div className="field">
            <label>Session ID</label>
            <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
          </div>
          <div className="field">
            <label>VRM URL</label>
            <input value={vrmUrl} onChange={(e) => setVrmUrl(e.target.value)} placeholder="https://...vrm" />
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
          <button onClick={startMic} disabled={state !== 'connected' || micActive}>
            Start Mic
          </button>
          <button onClick={stopMic} disabled={!micActive}>
            Stop Mic
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
      </section>

      <div className="main-grid">
        <section className="panel avatar-panel">
          <div className="section-head">
            <div>
              <div className="eyebrow">three-vrm + react-three-fiber</div>
              <h3>{avatarName ?? 'VRM Viewer'}</h3>
            </div>
            <div className="pill pill-soft">mouth {mouthOpen.toFixed(2)}</div>
          </div>
          <div className="canvas-wrap">
            <CanvasErrorBoundary
              resetKey={vrmUrl}
              onError={(err) => appendLog(`vrm load error: ${err.message}`)}
            >
              <AvatarCanvas key={vrmUrl} url={vrmUrl} mouthOpen={mouthOpen} onLoaded={setAvatarName} />
            </CanvasErrorBoundary>
          </div>
          <div className="avatar-meta">
            <div>
              <div className="eyebrow">VRM</div>
              <p className="mono small">{vrmUrl}</p>
            </div>
            <div>
              <div className="eyebrow">リップシンク</div>
              <div className="meter">
                <div className="bar" style={{ width: `${mouthOpen * 100}%` }} />
              </div>
            </div>
          </div>
        </section>

        <section className="panel chat-panel">
          <div className="section-head">
            <div>
              <div className="eyebrow">Text Chat Log</div>
              <h3>STT / LLM ストリーム</h3>
            </div>
          </div>
          <ChatLog turns={chatTurns} partial={partial} />
        </section>
      </div>

      <section className="panel log">
        <div className="section-head">
          <div>
            <div className="eyebrow">Events</div>
            <h3>WS / オーディオログ</h3>
          </div>
          <div className="pill pill-soft">max 80 entries</div>
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
      </section>
    </div>
  )
}

export default App
