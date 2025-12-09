import { DEFAULTS, useAppStore } from '../../store/appStore'

export function DiagnosticsDrawer() {
  const open = useAppStore((s) => s.diagnosticsDrawerOpen)
  const apiBaseUrl = useAppStore((s) => s.apiBaseUrl)
  const apiBase = useAppStore((s) => s.apiBase)
  const sttResult = useAppStore((s) => s.sttResult)
  const sttError = useAppStore((s) => s.sttError)
  const sttLoading = useAppStore((s) => s.sttLoading)
  const llmPrompt = useAppStore((s) => s.llmPrompt)
  const llmContext = useAppStore((s) => s.llmContext)
  const llmResult = useAppStore((s) => s.llmResult)
  const llmError = useAppStore((s) => s.llmError)
  const llmLoading = useAppStore((s) => s.llmLoading)
  const ttsText = useAppStore((s) => s.ttsText)
  const ttsVoice = useAppStore((s) => s.ttsVoice)
  const ttsMeta = useAppStore((s) => s.ttsMeta)
  const ttsAudioUrl = useAppStore((s) => s.ttsAudioUrl)
  const ttsError = useAppStore((s) => s.ttsError)
  const ttsLoading = useAppStore((s) => s.ttsLoading)
  const motionPrompt = useAppStore((s) => s.motionPrompt)
  const motionResult = useAppStore((s) => s.motionResult)
  const motionError = useAppStore((s) => s.motionError)
  const motionLoading = useAppStore((s) => s.motionLoading)
  const lastMotionEvent = useAppStore((s) => s.lastMotionEvent)
  const embeddingText = useAppStore((s) => s.embeddingText)
  const embeddingResult = useAppStore((s) => s.embeddingResult)
  const embeddingError = useAppStore((s) => s.embeddingError)
  const embeddingLoading = useAppStore((s) => s.embeddingLoading)
  const ragQuery = useAppStore((s) => s.ragQuery)
  const ragTopK = useAppStore((s) => s.ragTopK)
  const ragResult = useAppStore((s) => s.ragResult)
  const ragError = useAppStore((s) => s.ragError)
  const ragLoading = useAppStore((s) => s.ragLoading)
  const dbStatus = useAppStore((s) => s.dbStatus)
  const dbError = useAppStore((s) => s.dbError)
  const dbLoading = useAppStore((s) => s.dbLoading)
  const setDiagnosticsDrawerOpen = useAppStore((s) => s.setDiagnosticsDrawerOpen)
  const setApiBaseUrl = useAppStore((s) => s.setApiBaseUrl)
  const setSttFile = useAppStore((s) => s.setSttFile)
  const runSttCheck = useAppStore((s) => s.runSttCheck)
  const setLlmPrompt = useAppStore((s) => s.setLlmPrompt)
  const setLlmContext = useAppStore((s) => s.setLlmContext)
  const runLlmCheck = useAppStore((s) => s.runLlmCheck)
  const setTtsText = useAppStore((s) => s.setTtsText)
  const setTtsVoice = useAppStore((s) => s.setTtsVoice)
  const runTtsCheck = useAppStore((s) => s.runTtsCheck)
  const setMotionPrompt = useAppStore((s) => s.setMotionPrompt)
  const runMotionCheck = useAppStore((s) => s.runMotionCheck)
  const setEmbeddingText = useAppStore((s) => s.setEmbeddingText)
  const runEmbeddingCheck = useAppStore((s) => s.runEmbeddingCheck)
  const setRagQuery = useAppStore((s) => s.setRagQuery)
  const setRagTopK = useAppStore((s) => s.setRagTopK)
  const runRagCheck = useAppStore((s) => s.runRagCheck)
  const pingDatabase = useAppStore((s) => s.pingDatabase)
  const defaultApiBaseUrl = DEFAULTS.API_BASE_URL

  if (!open) return null

  return (
    <div className="drawer-card diagnostics-drawer diagnostics">
      <div className="drawer-head diag-headline">
        <div>
          <div className="eyebrow">要素別検証</div>
          <h3>Diagnostics Playground</h3>
          <p className="sub small">
            STT / LLM / TTS / Embedding / RAG / DB を個別に叩き、ボトルネックを切り分けます。
          </p>
        </div>
        <div className="field api-field">
          <label>API Base URL</label>
          <input value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} placeholder={defaultApiBaseUrl} />
          <p className="hint mono small">{`${apiBase}/diagnostics/...`}</p>
        </div>
        <button className="ghost" onClick={() => setDiagnosticsDrawerOpen(false)}>
          収納
        </button>
      </div>

      <div className="diag-grid">
        <div className="diag-card">
          <div className="diag-head">
            <div>
              <div className="eyebrow">Speech to Text</div>
              <h4>STT</h4>
            </div>
            <div className="pill pill-soft">{sttResult ? `${(sttResult.byteLength / 1024).toFixed(1)} KB` : 'audio → text'}</div>
          </div>
          <div className="diag-body">
            <label className="inline-label">音声ファイル</label>
            <input type="file" accept="audio/*" onChange={(e) => setSttFile(e.target.files?.[0] ?? null)} />
            <div className="diag-actions">
              <button onClick={runSttCheck} disabled={sttLoading}>
                {sttLoading ? 'Running...' : 'STT 実行'}
              </button>
              {sttResult?.fallbackUsed ? <span className="pill pill-hot">fallback</span> : null}
            </div>
            {sttError ? <p className="error-text">{sttError}</p> : null}
            {sttResult ? (
              <div className="diag-result">
                <div className="diag-meta mono small">
                  <span>{sttResult.provider}</span>
                  <span>{sttResult.endpoint}</span>
                </div>
                <p className="mono small">{sttResult.text || '（空文字列）'}</p>
              </div>
            ) : (
              <p className="hint">短い OGG/WebM を送り、音声のみでパイプラインを確認します。</p>
            )}
          </div>
        </div>

        <div className="diag-card">
          <div className="diag-head">
            <div>
              <div className="eyebrow">Language</div>
              <h4>LLM</h4>
            </div>
            <div className="pill pill-soft">{llmResult ? `${llmResult.latencyMs.toFixed(0)} ms` : 'prompt → tokens'}</div>
          </div>
          <div className="diag-body">
            <label className="inline-label">プロンプト</label>
            <textarea value={llmPrompt} onChange={(e) => setLlmPrompt(e.target.value)} rows={3} />
            <label className="inline-label">コンテキスト（任意）</label>
            <textarea
              value={llmContext}
              onChange={(e) => setLlmContext(e.target.value)}
              rows={2}
              placeholder="追加したい文脈があれば貼り付け"
            />
            <div className="diag-actions">
              <button onClick={runLlmCheck} disabled={llmLoading}>
                {llmLoading ? 'Running...' : 'LLM 実行'}
              </button>
              {llmResult ? <span className="pill pill-soft">tokens {llmResult.tokens.length}</span> : null}
              {llmResult?.fallbackUsed ? <span className="pill pill-hot">fallback</span> : null}
            </div>
            {llmError ? <p className="error-text">{llmError}</p> : null}
            {llmResult ? (
              <div className="diag-result">
                <div className="diag-meta mono small">
                  <span>{llmResult.provider}</span>
                  <span>{llmResult.endpoint}</span>
                </div>
                <p className="mono small preview-text">{llmResult.assistantText || '(empty response)'}</p>
              </div>
            ) : (
              <p className="hint">音声抜きで LLM 単体のレイテンシと応答をチェック。</p>
            )}
          </div>
        </div>

        <div className="diag-card">
          <div className="diag-head">
            <div>
              <div className="eyebrow">Text to Speech</div>
              <h4>TTS</h4>
            </div>
            <div className="pill pill-soft">{ttsMeta ? `${ttsMeta.byteLength} bytes` : 'text → audio'}</div>
          </div>
          <div className="diag-body">
            <label className="inline-label">テキスト</label>
            <textarea value={ttsText} onChange={(e) => setTtsText(e.target.value)} rows={3} />
            <label className="inline-label">Voice（任意）</label>
            <input value={ttsVoice} onChange={(e) => setTtsVoice(e.target.value)} placeholder="provider 側の音声 reference id" />
            <div className="diag-actions">
              <button onClick={runTtsCheck} disabled={ttsLoading}>
                {ttsLoading ? 'Running...' : 'TTS 実行'}
              </button>
              {ttsMeta?.fallbackUsed ? <span className="pill pill-hot">fallback</span> : null}
              {ttsMeta ? <span className="pill pill-soft">{ttsMeta.latencyMs.toFixed(0)} ms</span> : null}
            </div>
            {ttsError ? <p className="error-text">{ttsError}</p> : null}
            {ttsAudioUrl && ttsMeta ? (
              <div className="diag-result">
                <audio controls src={ttsAudioUrl} />
                <div className="diag-meta mono small">
                  <span>{ttsMeta.provider}</span>
                  <span>{ttsMeta.mimeType}</span>
                  <span>{ttsMeta.chunkCount} chunks</span>
                </div>
              </div>
            ) : (
              <p className="hint">音声合成のみを実行し、再生とフォーマットを確認。</p>
            )}
          </div>
        </div>

        <div className="diag-card">
          <div className="diag-head">
            <div>
              <div className="eyebrow">Motion</div>
              <h4>モーション生成</h4>
            </div>
            <div className="pill pill-soft">
              {motionResult ? `${Object.keys(motionResult.tracks).length} tracks` : 'prompt → track'}
            </div>
          </div>
          <div className="diag-body">
            <label className="inline-label">モーション指示</label>
            <textarea
              value={motionPrompt}
              onChange={(e) => setMotionPrompt(e.target.value)}
              rows={2}
              placeholder="例: 3秒で手を振る"
            />
            <div className="diag-actions">
              <button onClick={runMotionCheck} disabled={motionLoading}>
                {motionLoading ? 'Running...' : 'Motion 実行'}
              </button>
              {motionResult?.fallbackUsed || lastMotionEvent?.fallbackUsed ? (
                <span className="pill pill-hot">fallback</span>
              ) : null}
              {motionResult ? <span className="pill pill-soft">{motionResult.fps} fps</span> : null}
            </div>
            {motionError ? <p className="error-text">{motionError}</p> : null}
            {motionResult ? (
              <div className="diag-result">
                <div className="diag-meta mono small">
                  <span>{motionResult.provider ?? 'motion'}</span>
                  <span>{motionResult.format}</span>
                  <span>{motionResult.durationSec.toFixed(1)}s</span>
                </div>
                <p className="mono small preview-text">url: {motionResult.url || motionResult.outputPath}</p>
                <p className="mono small">
                  tracks: {Object.keys(motionResult.tracks).length}
                  {motionResult.rootPosition ? ` / root ${motionResult.rootPosition.length}` : ''}
                </p>
              </div>
            ) : (
              <p className="hint">SnapMoGen スタブの疎通確認。JSON キー列が返るかを検証。</p>
            )}
            {lastMotionEvent ? (
              <div className="diag-result">
                <div className="diag-meta mono small">
                  <span>WS</span>
                  <span>{lastMotionEvent.jobId || 'latest'}</span>
                </div>
                <p className="mono small preview-text">url: {lastMotionEvent.url || lastMotionEvent.outputPath}</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="diag-card">
          <div className="diag-head">
            <div>
              <div className="eyebrow">Embedding</div>
              <h4>ベクトル生成</h4>
            </div>
            <div className="pill pill-soft">{embeddingResult ? `${embeddingResult.dimensions} dim` : 'text → vector'}</div>
          </div>
          <div className="diag-body">
            <label className="inline-label">テキスト</label>
            <textarea value={embeddingText} onChange={(e) => setEmbeddingText(e.target.value)} rows={3} />
            <div className="diag-actions">
              <button onClick={runEmbeddingCheck} disabled={embeddingLoading}>
                {embeddingLoading ? 'Running...' : 'Embedding 実行'}
              </button>
              {embeddingResult?.fallbackUsed ? <span className="pill pill-hot">fallback</span> : null}
            </div>
            {embeddingError ? <p className="error-text">{embeddingError}</p> : null}
            {embeddingResult ? (
              <div className="diag-result">
                <div className="diag-meta mono small">
                  <span>{embeddingResult.provider}</span>
                  <span>{embeddingResult.endpoint}</span>
                </div>
                <p className="mono small vector-preview">
                  {embeddingResult.vector.slice(0, 8).map((value, idx) => (
                    <span key={idx} className="vector-chip">
                      {value.toFixed(3)}
                    </span>
                  ))}
                  {embeddingResult.vector.length > 8 ? ' ...' : ''}
                </p>
              </div>
            ) : (
              <p className="hint">RAG の前段となる埋め込み生成だけを計測。</p>
            )}
          </div>
        </div>

        <div className="diag-card">
          <div className="diag-head">
            <div>
              <div className="eyebrow">RAG</div>
              <h4>検索</h4>
            </div>
            <div className="pill pill-soft">{ragResult ? `${ragResult.documents.length} docs` : 'query → context'}</div>
          </div>
          <div className="diag-body">
            <label className="inline-label">クエリ</label>
            <input value={ragQuery} onChange={(e) => setRagQuery(e.target.value)} />
            <label className="inline-label">top_k</label>
            <input type="number" min={1} max={50} value={ragTopK} onChange={(e) => setRagTopK(e.target.value)} />
            <div className="diag-actions">
              <button onClick={runRagCheck} disabled={ragLoading}>
                {ragLoading ? 'Running...' : 'RAG 検索'}
              </button>
              {ragResult ? (
                <span className={`pill ${ragResult.ragIndexLoaded ? 'pill-soft' : 'pill-hot'}`}>
                  index {ragResult.ragIndexLoaded ? 'loaded' : 'not loaded'}
                </span>
              ) : null}
            </div>
            {ragError ? <p className="error-text">{ragError}</p> : null}
            {ragResult ? (
              <div className="diag-result">
                <div className="diag-meta mono small">
                  <span>top_k: {ragResult.topK}</span>
                  <span>docs: {ragResult.documents.length}</span>
                </div>
                <ul className="doc-list">
                  {ragResult.documents.map((doc, idx) => (
                    <li key={`${doc.source}-${idx}`}>
                      <div className="pill pill-soft">
                        #{idx + 1} {doc.source}
                      </div>
                      <p className="mono small">{doc.content}</p>
                    </li>
                  ))}
                </ul>
                <pre className="context-preview mono small">{ragResult.contextText || 'context empty'}</pre>
              </div>
            ) : (
              <p className="hint">FAISS や文書ロードの結果だけを先にチェック。</p>
            )}
          </div>
        </div>

        <div className="diag-card">
          <div className="diag-head">
            <div>
              <div className="eyebrow">Database</div>
              <h4>DB 接続</h4>
            </div>
            <div className="pill pill-soft">{dbStatus?.status ?? 'ping only'}</div>
          </div>
          <div className="diag-body">
            <p className="hint">DB だけを切り離してヘルス確認。ログ件数が取れれば書き込みも確認。</p>
            <div className="diag-actions">
              <button onClick={pingDatabase} disabled={dbLoading}>
                {dbLoading ? 'Pinging...' : 'DB Ping'}
              </button>
            </div>
            {dbError ? <p className="error-text">{dbError}</p> : null}
            {dbStatus ? (
              <div className="diag-result">
                <div className="diag-meta mono small">
                  <span>status: {dbStatus.status}</span>
                  {typeof dbStatus.conversationLogCount === 'number' ? <span>logs: {dbStatus.conversationLogCount}</span> : null}
                </div>
                {dbStatus.detail ? <p className="mono small">{dbStatus.detail}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
