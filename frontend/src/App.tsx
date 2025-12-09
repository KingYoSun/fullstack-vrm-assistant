import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { AvatarCanvas, CanvasErrorBoundary } from './components/avatar/AvatarCanvas'
import { ControlDock } from './components/session/ControlDock'
import { RemotePanel } from './components/panels/RemotePanel'
import { StreamPanel } from './components/panels/StreamPanel'
import { ConnectionDrawer } from './components/drawers/ConnectionDrawer'
import { PersonaDrawer } from './components/drawers/PersonaDrawer'
import { DiagnosticsDrawer } from './components/drawers/DiagnosticsDrawer'
import { LogsDrawer } from './components/drawers/LogsDrawer'
import type {
  ChatTurn,
  CharacterProfile,
  DbDiagResult,
  EmbeddingDiagResult,
  LatencyMap,
  LlmDiagResult,
  LogEntry,
  RagDiagResult,
  SttDiagResult,
  SystemPrompt,
  TtsDiagMeta,
  WsState,
} from './types/app'
import './App.css'

type WsPayload = {
  type?: string
  text?: string
  turn_id?: string
  assistant_text?: string
  token?: string
  latency_ms?: { stt?: number; llm?: number; tts?: number }
  sample_rate?: number
  channels?: number
  mouth_open?: number
  recoverable?: boolean
  message?: string
}

const DEFAULT_SYSTEM_PROMPT =
  'あなたは音声対応の VRM アシスタントです。ユーザーと自然な会話をするように口語で話し、本文は150文字以内にまとめてください。要点だけを端的に返し、一息で読み上げられる長さを維持します。提供されたコンテキストは関連する部分だけ取り込み、無い場合は簡潔に答えてください。'

type LegacyGetUserMedia = (
  constraints: MediaStreamConstraints,
  successCallback: (stream: MediaStream) => void,
  errorCallback?: (error: unknown) => void
) => void

type NavigatorWithLegacyGetUserMedia = Navigator & {
  getUserMedia?: LegacyGetUserMedia
  webkitGetUserMedia?: LegacyGetUserMedia
  mozGetUserMedia?: LegacyGetUserMedia
}

const DEFAULT_VRM = '/AliciaSolid.vrm'
const DEFAULT_WS_PATH = '/ws/session'
const DEFAULT_API_BASE_PATH = '/api/v1'

const normalizePath = (path: string, fallback = DEFAULT_WS_PATH) => {
  const base = path || fallback
  const withLeadingSlash = base.startsWith('/') ? base : `/${base}`
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
  const noBackendPort = import.meta.env.VITE_NO_BACKEND_PORT
  const port = envPort === '' || noBackendPort ? '' : envPort ?? '8000'
  const protocol =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const portPart = port ? `:${port}` : ''

  return `${protocol}//${host}${portPart}${wsPath}`
}

const DEFAULT_WS_BASE_URL = resolveDefaultWsBaseUrl()
const resolveDefaultApiBaseUrl = () => {
  const explicitBase = import.meta.env.VITE_API_BASE_URL
  if (explicitBase) return explicitBase.endsWith('/') ? explicitBase.slice(0, -1) : explicitBase

  const host =
    import.meta.env.VITE_BACKEND_HOST ||
    (typeof window !== 'undefined' && window.location.hostname) ||
    'localhost'
  const envPort = import.meta.env.VITE_BACKEND_PORT
  const noBackendPort = import.meta.env.VITE_NO_BACKEND_PORT
  const port = envPort === '' || noBackendPort ? '' : envPort ?? '8000'
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https:' : 'http:'
  const apiPath = normalizePath(import.meta.env.VITE_API_BASE_PATH ?? DEFAULT_API_BASE_PATH, DEFAULT_API_BASE_PATH)
  const portPart = port ? `:${port}` : ''

  return `${protocol}//${host}${portPart}${apiPath}`
}

const DEFAULT_API_BASE_URL = resolveDefaultApiBaseUrl()
const isMobileViewport = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches

function App() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_WS_BASE_URL)
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL)
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
  const [cameraResetKey, setCameraResetKey] = useState(0)
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([])
  const [sttFile, setSttFile] = useState<File | null>(null)
  const [sttResult, setSttResult] = useState<SttDiagResult | null>(null)
  const [sttError, setSttError] = useState<string | null>(null)
  const [sttLoading, setSttLoading] = useState(false)
  const [llmPrompt, setLlmPrompt] = useState('システムの状態を簡潔に教えて。')
  const [llmContext, setLlmContext] = useState('')
  const [llmResult, setLlmResult] = useState<LlmDiagResult | null>(null)
  const [llmError, setLlmError] = useState<string | null>(null)
  const [llmLoading, setLlmLoading] = useState(false)
  const [ttsText, setTtsText] = useState('これは音声合成のテストです。音質とレスポンスを確認します。')
  const [ttsVoice, setTtsVoice] = useState('')
  const [ttsMeta, setTtsMeta] = useState<TtsDiagMeta | null>(null)
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null)
  const [ttsError, setTtsError] = useState<string | null>(null)
  const [ttsLoading, setTtsLoading] = useState(false)
  const [embeddingText, setEmbeddingText] = useState('3D アバターの対話体験を向上させるためのヒントを教えて')
  const [embeddingResult, setEmbeddingResult] = useState<EmbeddingDiagResult | null>(null)
  const [embeddingError, setEmbeddingError] = useState<string | null>(null)
  const [embeddingLoading, setEmbeddingLoading] = useState(false)
  const [ragQuery, setRagQuery] = useState('このプロジェクトの目的は？')
  const [ragTopK, setRagTopK] = useState('4')
  const [ragResult, setRagResult] = useState<RagDiagResult | null>(null)
  const [ragError, setRagError] = useState<string | null>(null)
  const [ragLoading, setRagLoading] = useState(false)
  const [dbStatus, setDbStatus] = useState<DbDiagResult | null>(null)
  const [dbError, setDbError] = useState<string | null>(null)
  const [dbLoading, setDbLoading] = useState(false)
  const [characters, setCharacters] = useState<CharacterProfile[]>([])
  const [activeCharacterId, setActiveCharacterId] = useState<number | null>(null)
  const [characterForm, setCharacterForm] = useState({
    name: 'デフォルトキャラクター',
    persona: '',
    speakingStyle: '',
  })
  const [characterEditingId, setCharacterEditingId] = useState<number | null>(null)
  const [characterError, setCharacterError] = useState<string | null>(null)
  const [characterLoading, setCharacterLoading] = useState(false)
  const [characterSaving, setCharacterSaving] = useState(false)
  const [characterDeletingId, setCharacterDeletingId] = useState<number | null>(null)
  const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([])
  const [systemPromptEditingId, setSystemPromptEditingId] = useState<number | null>(null)
  const [systemPromptForm, setSystemPromptForm] = useState({
    title: 'デフォルトプロンプト',
    content: DEFAULT_SYSTEM_PROMPT,
    isActive: true,
  })
  const [systemPromptError, setSystemPromptError] = useState<string | null>(null)
  const [systemPromptLoading, setSystemPromptLoading] = useState(false)
  const [systemPromptSaving, setSystemPromptSaving] = useState(false)
  const [systemPromptDeletingId, setSystemPromptDeletingId] = useState<number | null>(null)
  const [connectionDrawerOpen, setConnectionDrawerOpen] = useState(false)
  const [personaDrawerOpen, setPersonaDrawerOpen] = useState(false)
  const [diagnosticsDrawerOpen, setDiagnosticsDrawerOpen] = useState(false)
  const [logsDrawerOpen, setLogsDrawerOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [showLatencyPanel, setShowLatencyPanel] = useState(false)
  const [isMobile, setIsMobile] = useState(isMobileViewport())
  const [remoteCollapsed, setRemoteCollapsed] = useState(isMobileViewport())
  const [streamCollapsed, setStreamCollapsed] = useState(isMobileViewport())
  const wsRef = useRef<WebSocket | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const ttsBuffersRef = useRef<Uint8Array[]>([])
  const ttsFormatRef = useRef<{ sampleRate: number; channels: number }>({ sampleRate: 16000, channels: 1 })
  const micBuffersRef = useRef<Uint8Array[]>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const mouthRafRef = useRef<number | null>(null)
  const currentTurnIdRef = useRef<string | null>(null)
  const messageQueueRef = useRef<Promise<void>>(Promise.resolve())
  const vrmFileInputRef = useRef<HTMLInputElement | null>(null)
  const localVrmObjectUrlRef = useRef<string | null>(null)

  const micSupported = useMemo(() => {
    if (typeof navigator === 'undefined') return false
    const nav = navigator as NavigatorWithLegacyGetUserMedia
    return Boolean(
      nav.mediaDevices?.getUserMedia ??
        nav.getUserMedia ??
        nav.webkitGetUserMedia ??
        nav.mozGetUserMedia
    )
  }, [])

  const apiBase = useMemo(() => {
    const base = (apiBaseUrl || DEFAULT_API_BASE_URL).trim()
    const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
    return trimmed || DEFAULT_API_BASE_URL
  }, [apiBaseUrl])

  const wsUrl = useMemo(() => {
    const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
    const query = activeCharacterId ? `?character_id=${activeCharacterId}` : ''
    return `${normalized}/${sessionId}${query}`
  }, [activeCharacterId, baseUrl, sessionId])

  const buildApiUrl = (path: string) => {
    const normalized = path.startsWith('/') ? path : `/${path}`
    return `${apiBase}${normalized}`
  }

  const parseError = (err: unknown) => (err instanceof Error ? err.message : String(err))

  const requestJson = async <T,>(path: string, init: RequestInit) => {
    const response = await fetch(buildApiUrl(path), init)
    const text = await response.text()
    if (!response.ok) {
      const message = text || `${response.status} ${response.statusText}`
      throw new Error(message)
    }
    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error('invalid JSON response from backend')
    }
  }

  useEffect(() => {
    return () => {
      wsRef.current?.close()
      stopMic()
      stopAudioMeter()
      if (localVrmObjectUrlRef.current) {
        URL.revokeObjectURL(localVrmObjectUrlRef.current)
        localVrmObjectUrlRef.current = null
      }
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

  useEffect(() => {
    return () => {
      if (ttsAudioUrl) {
        URL.revokeObjectURL(ttsAudioUrl)
      }
    }
  }, [ttsAudioUrl])

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
  }, [])

  useEffect(() => {
    if (isMobile) {
      setRemoteCollapsed(true)
      setStreamCollapsed(true)
      setConnectionDrawerOpen(false)
      setPersonaDrawerOpen(false)
      setDiagnosticsDrawerOpen(false)
      setLogsDrawerOpen(false)
      setHistoryOpen(false)
      setShowLatencyPanel(false)
    } else {
      setRemoteCollapsed(false)
      setStreamCollapsed(false)
    }
  }, [isMobile])

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

  const updateVrmUrl = (nextUrl: string, options: { isLocal?: boolean } = {}) => {
    if (localVrmObjectUrlRef.current && localVrmObjectUrlRef.current !== nextUrl) {
      URL.revokeObjectURL(localVrmObjectUrlRef.current)
      localVrmObjectUrlRef.current = null
    }
    if (options.isLocal) {
      localVrmObjectUrlRef.current = nextUrl
    }
    setVrmUrl(nextUrl)
  }

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

  const mapCharacter = (data: {
    id: number
    name: string
    persona: string
    speaking_style?: string | null
    created_at: string
    updated_at: string
  }): CharacterProfile => ({
    id: data.id,
    name: data.name,
    persona: data.persona,
    speakingStyle: data.speaking_style ?? '',
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  })

  const mapSystemPrompt = (data: {
    id: number
    title: string
    content: string
    is_active: boolean
    created_at: string
    updated_at: string
  }): SystemPrompt => ({
    id: data.id,
    title: data.title,
    content: data.content,
    isActive: data.is_active,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  })

  const resetCharacterForm = () => {
    setCharacterError(null)
    setCharacterEditingId(null)
    setCharacterForm({
      name: 'デフォルトキャラクター',
      persona: '',
      speakingStyle: '',
    })
  }

  const resetSystemPromptForm = () => {
    setSystemPromptError(null)
    setSystemPromptEditingId(null)
    setSystemPromptForm({
      title: 'デフォルトプロンプト',
      content: DEFAULT_SYSTEM_PROMPT,
      isActive: true,
    })
  }

  const handleChangeCharacterForm = (key: 'name' | 'persona' | 'speakingStyle', value: string) => {
    setCharacterForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleChangeSystemPromptForm = (key: 'title' | 'content' | 'isActive', value: string | boolean) => {
    setSystemPromptForm((prev) => ({ ...prev, [key]: key === 'isActive' ? Boolean(value) : String(value) }))
  }

  const loadCharacters = async () => {
    setCharacterError(null)
    setCharacterLoading(true)
    try {
      const data = await requestJson<
        {
          id: number
          name: string
          persona: string
          speaking_style?: string | null
          created_at: string
          updated_at: string
        }[]
      >('/characters', { method: 'GET' })
      const mapped = data.map(mapCharacter)
      setCharacters(mapped)
      if (!mapped.length) {
        setActiveCharacterId(null)
        setCharacterEditingId(null)
        resetCharacterForm()
      } else if (activeCharacterId && !mapped.some((c) => c.id === activeCharacterId)) {
        setActiveCharacterId(mapped[0]?.id ?? null)
      } else if (!activeCharacterId) {
        setActiveCharacterId(mapped[0].id)
      }
    } catch (err) {
      const message = parseError(err)
      setCharacterError(message)
      appendLog(`characters: load failed (${message})`)
    } finally {
      setCharacterLoading(false)
    }
  }

  const loadSystemPrompts = async () => {
    setSystemPromptError(null)
    setSystemPromptLoading(true)
    try {
      const data = await requestJson<
        {
          id: number
          title: string
          content: string
          is_active: boolean
          created_at: string
          updated_at: string
        }[]
      >('/system-prompts', { method: 'GET' })
      const mapped = data.map(mapSystemPrompt).sort((a, b) => a.id - b.id)
      setSystemPrompts(mapped)
      if (!mapped.length) {
        resetSystemPromptForm()
      } else if (systemPromptEditingId && !mapped.some((p) => p.id === systemPromptEditingId)) {
        resetSystemPromptForm()
      }
    } catch (err) {
      const message = parseError(err)
      setSystemPromptError(message)
      appendLog(`system prompts: load failed (${message})`)
    } finally {
      setSystemPromptLoading(false)
    }
  }

  const handleSelectCharacter = (id: number | null) => {
    setCharacterError(null)
    setActiveCharacterId(id)
    if (id === null) {
      setCharacterEditingId(null)
      appendLog('characters: デフォルトプロンプトに戻しました')
    } else {
      appendLog(`characters: 適用 id=${id}`)
    }
  }

  const startEditCharacter = (profile: CharacterProfile) => {
    setCharacterError(null)
    setCharacterEditingId(profile.id)
    setCharacterForm({
      name: profile.name,
      persona: profile.persona,
      speakingStyle: profile.speakingStyle ?? '',
    })
  }

  const startEditSystemPrompt = (prompt: SystemPrompt) => {
    setSystemPromptError(null)
    setSystemPromptEditingId(prompt.id)
    setSystemPromptForm({
      title: prompt.title,
      content: prompt.content,
      isActive: prompt.isActive,
    })
  }

  const saveSystemPrompt = async () => {
    setSystemPromptError(null)
    const title = systemPromptForm.title.trim()
    const content = systemPromptForm.content.trim()
    if (!title || !content) {
      setSystemPromptError('タイトルと本文を入力してください')
      return
    }
    setSystemPromptSaving(true)
    try {
      const payload = {
        title,
        content,
        is_active: systemPromptForm.isActive,
      }
      const path = systemPromptEditingId ? `/system-prompts/${systemPromptEditingId}` : '/system-prompts'
      const method = systemPromptEditingId ? 'PUT' : 'POST'
      const data = await requestJson<{
        id: number
        title: string
        content: string
        is_active: boolean
        created_at: string
        updated_at: string
      }>(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const saved = mapSystemPrompt(data)
      setSystemPrompts((prev) => {
        let next = prev.filter((p) => p.id !== saved.id)
        if (saved.isActive) {
          next = next.map((p) => ({ ...p, isActive: false }))
        }
        return [...next, saved].sort((a, b) => a.id - b.id)
      })
      setSystemPromptEditingId(saved.id)
      setSystemPromptForm({
        title: saved.title,
        content: saved.content,
        isActive: saved.isActive,
      })
      appendLog(`system prompts: saved ${saved.title} (id=${saved.id})${saved.isActive ? ' [active]' : ''}`)
    } catch (err) {
      const message = parseError(err)
      setSystemPromptError(message)
      appendLog(`system prompts: save failed (${message})`)
    } finally {
      setSystemPromptSaving(false)
    }
  }

  const deleteSystemPrompt = async (id: number) => {
    if (typeof window !== 'undefined' && !window.confirm('このシステムプロンプトを削除しますか？')) {
      return
    }
    setSystemPromptError(null)
    setSystemPromptDeletingId(id)
    try {
      const response = await fetch(buildApiUrl(`/system-prompts/${id}`), { method: 'DELETE' })
      const text = await response.text()
      if (!response.ok) {
        const message = text || `${response.status} ${response.statusText}`
        throw new Error(message)
      }
      setSystemPrompts((prev) => prev.filter((p) => p.id !== id))
      if (systemPromptEditingId === id) {
        resetSystemPromptForm()
      }
      appendLog(`system prompts: deleted id=${id}`)
      void loadSystemPrompts()
    } catch (err) {
      const message = parseError(err)
      setSystemPromptError(message)
      appendLog(`system prompts: delete failed (${message})`)
    } finally {
      setSystemPromptDeletingId(null)
    }
  }

  const setActiveSystemPrompt = async (id: number) => {
    setSystemPromptError(null)
    try {
      await requestJson(`/system-prompts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: true }),
      })
      appendLog(`system prompts: set active id=${id}`)
      await loadSystemPrompts()
    } catch (err) {
      const message = parseError(err)
      setSystemPromptError(message)
      appendLog(`system prompts: activate failed (${message})`)
    }
  }

  const saveCharacter = async () => {
    setCharacterError(null)
    const name = characterForm.name.trim()
    const persona = characterForm.persona.trim()
    const speakingStyle = characterForm.speakingStyle.trim()
    if (!name || !persona) {
      setCharacterError('名前とキャラクター設定を入力してください')
      return
    }
    setCharacterSaving(true)
    try {
      const payload = {
        name,
        persona,
        speaking_style: speakingStyle || undefined,
      }
      const path = characterEditingId ? `/characters/${characterEditingId}` : '/characters'
      const method = characterEditingId ? 'PUT' : 'POST'
      const data = await requestJson<{
        id: number
        name: string
        persona: string
        speaking_style?: string | null
        created_at: string
        updated_at: string
      }>(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const saved = mapCharacter(data)
      setCharacters((prev) => {
        const next = prev.filter((c) => c.id !== saved.id)
        return [...next, saved].sort((a, b) => a.id - b.id)
      })
      setActiveCharacterId(saved.id)
      setCharacterEditingId(saved.id)
      setCharacterForm({
        name: saved.name,
        persona: saved.persona,
        speakingStyle: saved.speakingStyle ?? '',
      })
      appendLog(`characters: saved ${saved.name} (id=${saved.id})`)
    } catch (err) {
      const message = parseError(err)
      setCharacterError(message)
      appendLog(`characters: save failed (${message})`)
    } finally {
      setCharacterSaving(false)
    }
  }

  const deleteCharacter = async (id: number) => {
    if (typeof window !== 'undefined' && !window.confirm('このキャラクターを削除しますか？')) {
      return
    }
    setCharacterError(null)
    setCharacterDeletingId(id)
    try {
      const response = await fetch(buildApiUrl(`/characters/${id}`), { method: 'DELETE' })
      const text = await response.text()
      if (!response.ok) {
        const message = text || `${response.status} ${response.statusText}`
        throw new Error(message)
      }
      setCharacters((prev) => {
        const next = prev.filter((c) => c.id !== id)
        if (activeCharacterId === id) {
          setActiveCharacterId(next[0]?.id ?? null)
        }
        return next
      })
      if (characterEditingId === id) {
        resetCharacterForm()
      }
      appendLog(`characters: deleted id=${id}`)
    } catch (err) {
      const message = parseError(err)
      setCharacterError(message)
      appendLog(`characters: delete failed (${message})`)
    } finally {
      setCharacterDeletingId(null)
    }
  }

  useEffect(() => {
    setCharacters([])
    setActiveCharacterId(null)
    resetCharacterForm()
    setSystemPrompts([])
    resetSystemPromptForm()
    void loadCharacters()
    void loadSystemPrompts()
  }, [apiBase])

  useEffect(() => {
    if (!micSupported) {
      const hint =
        typeof window !== 'undefined' && !window.isSecureContext
          ? 'secure context ではないためマイク API が無効です（HTTPS または localhost で開いてください）'
          : 'ブラウザがマイク API をサポートしていません'
      appendLog(`mic unsupported: ${hint}`)
    }
  }, [micSupported])

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
    micBuffersRef.current = []
    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    messageQueueRef.current = Promise.resolve()
    wsRef.current = ws

    ws.onopen = () => {
      setState('connected')
      appendLog(`connected: ${wsUrl}`)
    }
    ws.onclose = (event) => {
      setState('disconnected')
      currentTurnIdRef.current = null
      messageQueueRef.current = Promise.resolve()
      appendLog(`closed (${event.code}): ${event.reason || 'no reason'}`)
      stopMic()
      stopAudioMeter()
    }
    ws.onerror = () => {
      appendLog('websocket error')
    }
    ws.onmessage = (event) => {
      // メッセージを直列化し、音声バイナリが順序通りに溜まるようにする
      messageQueueRef.current = messageQueueRef.current
        .then(() => handleMessage(event.data))
        .catch((err) => {
          appendLog(`message handler error: ${err instanceof Error ? err.message : String(err)}`)
        })
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

  const requestMicStream = async () => {
    if (typeof navigator === 'undefined') {
      throw new Error('navigator is not available（非ブラウザ環境）')
    }
    const nav = navigator as NavigatorWithLegacyGetUserMedia
    const mediaDevicesGetUserMedia = nav.mediaDevices?.getUserMedia
    if (mediaDevicesGetUserMedia) {
      return mediaDevicesGetUserMedia.call(nav.mediaDevices, { audio: true })
    }
    const legacy = nav.getUserMedia ?? nav.webkitGetUserMedia ?? nav.mozGetUserMedia
    if (legacy) {
      return new Promise<MediaStream>((resolve, reject) => {
        legacy.call(nav, { audio: true }, resolve, reject)
      })
    }
    const secureContext = typeof window !== 'undefined' ? window.isSecureContext : true
    const hint = secureContext
      ? 'ブラウザがマイク API をサポートしていません'
      : 'HTTPS または localhost でアクセスしてください（secure context でないためマイク API が無効）'
    throw new Error(hint)
  }

  const startMic = async () => {
    if (micActive || state !== 'connected') return
    try {
      // 再生中の TTS を止め、録音をクリーンに開始する
      stopAudioMeter()
      if (audioSourceRef.current) {
        try {
          audioSourceRef.current.stop()
        } catch {
          // noop
        }
      }
      micBuffersRef.current = []
      const stream = await requestMicStream()
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 })
      recorder.ondataavailable = async (event) => {
        if (event.data && event.data.size > 0) {
          const buffer = await event.data.arrayBuffer()
          micBuffersRef.current.push(new Uint8Array(buffer))
        }
      }
      recorder.start(100)
      mediaRecorderRef.current = recorder
      setMicActive(true)
      appendLog('mic started (one-shot)')
    } catch (err) {
      appendLog(`mic error: ${(err as Error).message}`)
    }
  }

  const stopMic = (options?: { flush?: boolean; reason?: string }) => {
    const { flush = false, reason } = options ?? {}
    const wasActive = Boolean(mediaRecorderRef.current)
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop())
      mediaRecorderRef.current = null
      setMicActive(false)
    }
    if (flush && wsRef.current && state === 'connected') {
      const chunks = micBuffersRef.current
      if (chunks.length) {
        const payload = concatUint8Arrays(chunks)
        wsRef.current.send(payload.buffer)
      }
      micBuffersRef.current = []
      wsRef.current.send(JSON.stringify({ type: 'flush' }))
    }
    if (wasActive || flush) {
      appendLog(`mic stopped${reason ? ` (${reason})` : ''}${flush ? ' + flush' : ''}`)
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
    ttsBuffersRef.current = []
    const combined = concatUint8Arrays(buffers)
    const detectedMime = detectAudioMime(combined)
    const { sampleRate, channels } = ttsFormatRef.current
    const audioBytes = detectedMime ? combined : pcmToWav(combined, sampleRate, channels)
    const mimeType = detectedMime ?? 'audio/wav'
    const blob = new Blob([audioBytes], { type: mimeType })
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

  const handleJson = (payload: WsPayload) => {
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
        stopMic({ reason: 'final_transcript' })
        if (typeof payload.latency_ms?.stt === 'number') {
          const sttLatency = payload.latency_ms.stt
          setLatency((prev) => ({ ...prev, stt: sttLatency }))
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
        const latency = payload.latency_ms
        if (latency) {
          setLatency((prev) => ({
            ...prev,
            stt: latency.stt ?? prev.stt,
            llm: latency.llm ?? prev.llm,
          }))
        }
        break
      }
      case 'tts_start': {
        setTtsBytes(0)
        ttsBuffersRef.current = []
        const sampleRate =
          typeof payload.sample_rate === 'number' && payload.sample_rate > 0 ? payload.sample_rate : 16000
        const channels =
          typeof payload.channels === 'number' && payload.channels > 0 ? payload.channels : 1
        ttsFormatRef.current = { sampleRate, channels }
        appendLog(`tts_start turn=${payload.turn_id}`)
        break
      }
      case 'tts_end': {
        appendLog(`tts_end turn=${payload.turn_id}`)
        void playTtsBuffer()
        const latency = payload.latency_ms
        if (latency) {
          setLatency((prev) => ({
            ...prev,
            llm: latency.llm ?? prev.llm,
            tts: latency.tts ?? prev.tts,
          }))
        }
        break
      }
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

  const audioFromBase64 = (base64: string, mimeType: string) => {
    const binary = atob(base64)
    const buffer = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      buffer[i] = binary.charCodeAt(i)
    }
    return new Blob([buffer], { type: mimeType })
  }

  const detectAudioMime = (data: Uint8Array): string | null => {
    if (data.length < 12) return null
    if (data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53) return 'audio/ogg'
    if (
      data[0] === 0x52 &&
      data[1] === 0x49 &&
      data[2] === 0x46 &&
      data[3] === 0x46 &&
      data[8] === 0x57 &&
      data[9] === 0x41 &&
      data[10] === 0x56 &&
      data[11] === 0x45
    ) {
      return 'audio/wav'
    }
    if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) return 'audio/webm'
    return null
  }

  const pcmToWav = (pcm: Uint8Array, sampleRate: number, channels = 1) => {
    const sampleWidth = 2
    const blockAlign = channels * sampleWidth
    const byteRate = sampleRate * blockAlign
    const buffer = new ArrayBuffer(44 + pcm.byteLength)
    const view = new DataView(buffer)

    const writeString = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i += 1) {
        view.setUint8(offset + i, value.charCodeAt(i))
      }
    }

    writeString(0, 'RIFF')
    view.setUint32(4, 36 + pcm.byteLength, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, channels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, sampleWidth * 8, true)
    writeString(36, 'data')
    view.setUint32(40, pcm.byteLength, true)

    new Uint8Array(buffer, 44).set(pcm)
    return new Uint8Array(buffer)
  }

  const concatUint8Arrays = (chunks: Uint8Array[]) => {
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    const result = new Uint8Array(total)
    let offset = 0
    chunks.forEach((chunk) => {
      result.set(chunk, offset)
      offset += chunk.byteLength
    })
    return result
  }

  const runSttCheck = async () => {
    setSttError(null)
    if (!sttFile) {
      setSttError('音声ファイルを選択してください')
      return
    }
    setSttLoading(true)
    try {
      const form = new FormData()
      form.append('audio', sttFile)
      const data = await requestJson<{
        text: string
        byte_length: number
        provider: string
        endpoint: string
        fallback_used: boolean
      }>('/diagnostics/stt', { method: 'POST', body: form })
      setSttResult({
        text: data.text,
        byteLength: data.byte_length,
        provider: data.provider,
        endpoint: data.endpoint,
        fallbackUsed: data.fallback_used,
      })
      appendLog(`diagnostics: stt ok (${data.byte_length} bytes)`)
    } catch (err) {
      const message = parseError(err)
      setSttError(message)
      appendLog(`diagnostics: stt failed (${message})`)
    } finally {
      setSttLoading(false)
    }
  }

  const runLlmCheck = async () => {
    setLlmError(null)
    const prompt = llmPrompt.trim()
    const context = llmContext.trim()
    if (!prompt) {
      setLlmError('プロンプトを入力してください')
      return
    }
    setLlmLoading(true)
    try {
      const data = await requestJson<{
        assistant_text: string
        tokens: string[]
        latency_ms: number
        provider: string
        endpoint: string
        fallback_used: boolean
      }>('/diagnostics/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          context: context || undefined,
          character_id: activeCharacterId ?? undefined,
        }),
      })
      setLlmResult({
        assistantText: data.assistant_text,
        tokens: data.tokens,
        latencyMs: data.latency_ms,
        provider: data.provider,
        endpoint: data.endpoint,
        fallbackUsed: data.fallback_used,
      })
      appendLog(`diagnostics: llm ok (${data.tokens.length} tokens)`)
    } catch (err) {
      const message = parseError(err)
      setLlmError(message)
      appendLog(`diagnostics: llm failed (${message})`)
    } finally {
      setLlmLoading(false)
    }
  }

  const runTtsCheck = async () => {
    setTtsError(null)
    const text = ttsText.trim()
    const voice = ttsVoice.trim()
    if (!text) {
      setTtsError('TTS テキストを入力してください')
      return
    }
    setTtsLoading(true)
    try {
      const data = await requestJson<{
        audio_base64: string
        mime_type: string
        byte_length: number
        chunk_count: number
        latency_ms: number
        provider: string
        endpoint: string
        sample_rate: number
        fallback_used: boolean
      }>('/diagnostics/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: voice || undefined }),
      })
      const blob = audioFromBase64(data.audio_base64, data.mime_type)
      const nextUrl = URL.createObjectURL(blob)
      setTtsAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return nextUrl
      })
      setTtsMeta({
        mimeType: data.mime_type,
        byteLength: data.byte_length,
        chunkCount: data.chunk_count,
        latencyMs: data.latency_ms,
        provider: data.provider,
        endpoint: data.endpoint,
        sampleRate: data.sample_rate,
        fallbackUsed: data.fallback_used,
      })
      appendLog(`diagnostics: tts ok (${data.byte_length} bytes)`)
    } catch (err) {
      const message = parseError(err)
      setTtsError(message)
      setTtsMeta(null)
      setTtsAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      appendLog(`diagnostics: tts failed (${message})`)
    } finally {
      setTtsLoading(false)
    }
  }

  const runEmbeddingCheck = async () => {
    setEmbeddingError(null)
    const text = embeddingText.trim()
    if (!text) {
      setEmbeddingError('テキストを入力してください')
      return
    }
    setEmbeddingLoading(true)
    try {
      const data = await requestJson<{
        vector: number[]
        dimensions: number
        provider: string
        endpoint: string
        fallback_used: boolean
      }>('/diagnostics/embedding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      setEmbeddingResult({
        vector: data.vector,
        dimensions: data.dimensions,
        provider: data.provider,
        endpoint: data.endpoint,
        fallbackUsed: data.fallback_used,
      })
      appendLog(`diagnostics: embedding ok (dim=${data.dimensions})`)
    } catch (err) {
      const message = parseError(err)
      setEmbeddingError(message)
      appendLog(`diagnostics: embedding failed (${message})`)
    } finally {
      setEmbeddingLoading(false)
    }
  }

  const runRagCheck = async () => {
    setRagError(null)
    const query = ragQuery.trim()
    const trimmedTopK = ragTopK.trim()
    const topKNumber = trimmedTopK ? Number(trimmedTopK) : undefined
    if (!query) {
      setRagError('クエリを入力してください')
      return
    }
    if (topKNumber !== undefined && (!Number.isFinite(topKNumber) || topKNumber <= 0)) {
      setRagError('top_k は 1 以上の数値で入力してください')
      return
    }
    setRagLoading(true)
    try {
      const payload: Record<string, string | number> = { query }
      if (topKNumber !== undefined) {
        payload.top_k = topKNumber
      }
      const data = await requestJson<{
        query: string
        documents: { source: string; content: string }[]
        context_text: string
        rag_index_loaded: boolean
        top_k: number
      }>('/diagnostics/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setRagResult({
        query: data.query,
        documents: data.documents,
        contextText: data.context_text,
        ragIndexLoaded: data.rag_index_loaded,
        topK: data.top_k,
      })
      appendLog(`diagnostics: rag ok (docs=${data.documents.length})`)
    } catch (err) {
      const message = parseError(err)
      setRagError(message)
      appendLog(`diagnostics: rag failed (${message})`)
    } finally {
      setRagLoading(false)
    }
  }

  const pingDatabase = async () => {
    setDbError(null)
    setDbLoading(true)
    try {
      const data = await requestJson<{
        status: string
        detail?: string | null
        conversation_log_count?: number | null
      }>('/diagnostics/db', { method: 'GET' })
      setDbStatus({
        status: data.status,
        detail: data.detail,
        conversationLogCount: data.conversation_log_count,
      })
      appendLog(`diagnostics: db status ${data.status}`)
    } catch (err) {
      const message = parseError(err)
      setDbError(message)
      appendLog(`diagnostics: db failed (${message})`)
    } finally {
      setDbLoading(false)
    }
  }

  return (
    <div className="scene-shell">
      <div className="scene-canvas">
        <CanvasErrorBoundary resetKey={vrmUrl} onError={(err) => appendLog(`vrm load error: ${err.message}`)}>
          <AvatarCanvas
            key={vrmUrl}
            url={vrmUrl}
            mouthOpen={mouthOpen}
            onLoaded={setAvatarName}
            recenterKey={cameraResetKey}
          />
        </CanvasErrorBoundary>
      </div>

      <ControlDock
        state={state}
        micActive={micActive}
        micSupported={micSupported}
        isMobile={isMobile}
        canResetCamera={Boolean(avatarName)}
        onConnect={connect}
        onDisconnect={disconnect}
        onStartMic={startMic}
        onStopMic={() => stopMic({ flush: true, reason: 'manual stop' })}
        onResetCamera={() => setCameraResetKey((key) => key + 1)}
      />

      <RemotePanel
        isMobile={isMobile}
        remoteCollapsed={remoteCollapsed}
        connectionDrawerOpen={connectionDrawerOpen}
        personaDrawerOpen={personaDrawerOpen}
        diagnosticsDrawerOpen={diagnosticsDrawerOpen}
        logsDrawerOpen={logsDrawerOpen}
        mouthOpen={mouthOpen}
        avatarName={avatarName}
        vrmFileInputRef={vrmFileInputRef}
        onToggleRemote={() => setRemoteCollapsed((open) => !open)}
        onToggleConnection={() => setConnectionDrawerOpen((open) => !open)}
        onTogglePersona={() => setPersonaDrawerOpen((open) => !open)}
        onToggleDiagnostics={() => setDiagnosticsDrawerOpen((open) => !open)}
        onToggleLogs={() => setLogsDrawerOpen((open) => !open)}
        onOpenVrmFilePicker={openVrmFilePicker}
        onVrmFileChange={handleVrmFileChange}
      />

      <StreamPanel
        isMobile={isMobile}
        streamCollapsed={streamCollapsed}
        historyOpen={historyOpen}
        showLatencyPanel={showLatencyPanel}
        partial={partial}
        chatTurns={chatTurns}
        latency={latency}
        onToggleHistory={() => setHistoryOpen((open) => !open)}
        onToggleLatency={() => setShowLatencyPanel((open) => !open)}
        onToggleStream={() => setStreamCollapsed((open) => !open)}
      />

      <div className="ui-overlay">
        <div className="drawer-stack">
          <ConnectionDrawer
            open={connectionDrawerOpen}
            wsUrl={wsUrl}
            baseUrl={baseUrl}
            sessionId={sessionId}
            vrmUrl={vrmUrl}
            state={state}
            partial={partial}
            lastUserText={lastUserText}
            lastAssistantText={lastAssistantText}
            ttsBytes={ttsBytes}
            micActive={micActive}
            micSupported={micSupported}
            defaultWsBaseUrl={DEFAULT_WS_BASE_URL}
            onClose={() => setConnectionDrawerOpen(false)}
            onConnect={connect}
            onDisconnect={disconnect}
            onPing={() => sendControl('ping')}
            onFlush={() => sendControl('flush')}
            onResume={() => sendControl('resume')}
            onStartMic={startMic}
            onStopMic={() => stopMic({ flush: true, reason: 'manual stop' })}
            onChangeBaseUrl={setBaseUrl}
            onChangeSessionId={setSessionId}
            onChangeVrmUrl={updateVrmUrl}
          />
          <PersonaDrawer
            open={personaDrawerOpen}
            characters={characters}
            characterForm={characterForm}
            characterEditingId={characterEditingId}
            characterError={characterError}
            characterLoading={characterLoading}
            characterSaving={characterSaving}
            characterDeletingId={characterDeletingId}
            activeCharacterId={activeCharacterId}
            systemPrompts={systemPrompts}
            systemPromptForm={systemPromptForm}
            systemPromptEditingId={systemPromptEditingId}
            systemPromptError={systemPromptError}
            systemPromptLoading={systemPromptLoading}
            systemPromptSaving={systemPromptSaving}
            systemPromptDeletingId={systemPromptDeletingId}
            defaultSystemPrompt={DEFAULT_SYSTEM_PROMPT}
            onClose={() => setPersonaDrawerOpen(false)}
            onSelectCharacter={handleSelectCharacter}
            onStartEditCharacter={startEditCharacter}
            onDeleteCharacter={deleteCharacter}
            onChangeCharacterForm={handleChangeCharacterForm}
            onSaveCharacter={saveCharacter}
            onResetCharacterForm={resetCharacterForm}
            onStartEditSystemPrompt={startEditSystemPrompt}
            onDeleteSystemPrompt={deleteSystemPrompt}
            onSetActiveSystemPrompt={setActiveSystemPrompt}
            onChangeSystemPromptForm={handleChangeSystemPromptForm}
            onSaveSystemPrompt={saveSystemPrompt}
            onResetSystemPromptForm={resetSystemPromptForm}
          />
          <DiagnosticsDrawer
            open={diagnosticsDrawerOpen}
            apiBaseUrl={apiBaseUrl}
            apiBase={apiBase}
            defaultApiBaseUrl={DEFAULT_API_BASE_URL}
            sttResult={sttResult}
            sttError={sttError}
            sttLoading={sttLoading}
            llmPrompt={llmPrompt}
            llmContext={llmContext}
            llmResult={llmResult}
            llmError={llmError}
            llmLoading={llmLoading}
            ttsText={ttsText}
            ttsVoice={ttsVoice}
            ttsMeta={ttsMeta}
            ttsAudioUrl={ttsAudioUrl}
            ttsError={ttsError}
            ttsLoading={ttsLoading}
            embeddingText={embeddingText}
            embeddingResult={embeddingResult}
            embeddingError={embeddingError}
            embeddingLoading={embeddingLoading}
            ragQuery={ragQuery}
            ragTopK={ragTopK}
            ragResult={ragResult}
            ragError={ragError}
            ragLoading={ragLoading}
            dbStatus={dbStatus}
            dbError={dbError}
            dbLoading={dbLoading}
            onClose={() => setDiagnosticsDrawerOpen(false)}
            onChangeApiBaseUrl={setApiBaseUrl}
            onChangeSttFile={setSttFile}
            onRunSttCheck={runSttCheck}
            onChangeLlmPrompt={setLlmPrompt}
            onChangeLlmContext={setLlmContext}
            onRunLlmCheck={runLlmCheck}
            onChangeTtsText={setTtsText}
            onChangeTtsVoice={setTtsVoice}
            onRunTtsCheck={runTtsCheck}
            onChangeEmbeddingText={setEmbeddingText}
            onRunEmbeddingCheck={runEmbeddingCheck}
            onChangeRagQuery={setRagQuery}
            onChangeRagTopK={setRagTopK}
            onRunRagCheck={runRagCheck}
            onPingDatabase={pingDatabase}
          />
          <LogsDrawer open={logsDrawerOpen} logs={logs} onClose={() => setLogsDrawerOpen(false)} />
        </div>
      </div>
    </div>
  )
}

export default App
