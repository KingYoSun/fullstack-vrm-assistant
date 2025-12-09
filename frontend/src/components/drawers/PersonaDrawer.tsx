import type { CharacterProfile, SystemPrompt } from '../../types/app'

type PersonaDrawerProps = {
  open: boolean
  characters: CharacterProfile[]
  characterForm: { name: string; persona: string; speakingStyle: string }
  characterEditingId: number | null
  characterError: string | null
  characterLoading: boolean
  characterSaving: boolean
  characterDeletingId: number | null
  activeCharacterId: number | null
  systemPrompts: SystemPrompt[]
  systemPromptForm: { title: string; content: string; isActive: boolean }
  systemPromptEditingId: number | null
  systemPromptError: string | null
  systemPromptLoading: boolean
  systemPromptSaving: boolean
  systemPromptDeletingId: number | null
  defaultSystemPrompt: string
  onClose: () => void
  onSelectCharacter: (id: number | null) => void
  onStartEditCharacter: (profile: CharacterProfile) => void
  onDeleteCharacter: (id: number) => void
  onChangeCharacterForm: (key: 'name' | 'persona' | 'speakingStyle', value: string) => void
  onSaveCharacter: () => void
  onResetCharacterForm: () => void
  onStartEditSystemPrompt: (prompt: SystemPrompt) => void
  onDeleteSystemPrompt: (id: number) => void
  onSetActiveSystemPrompt: (id: number) => void
  onChangeSystemPromptForm: (key: 'title' | 'content' | 'isActive', value: string | boolean) => void
  onSaveSystemPrompt: () => void
  onResetSystemPromptForm: () => void
}

export function PersonaDrawer({
  open,
  characters,
  characterForm,
  characterEditingId,
  characterError,
  characterLoading,
  characterSaving,
  characterDeletingId,
  activeCharacterId,
  systemPrompts,
  systemPromptForm,
  systemPromptEditingId,
  systemPromptError,
  systemPromptLoading,
  systemPromptSaving,
  systemPromptDeletingId,
  defaultSystemPrompt,
  onClose,
  onSelectCharacter,
  onStartEditCharacter,
  onDeleteCharacter,
  onChangeCharacterForm,
  onSaveCharacter,
  onResetCharacterForm,
  onStartEditSystemPrompt,
  onDeleteSystemPrompt,
  onSetActiveSystemPrompt,
  onChangeSystemPromptForm,
  onSaveSystemPrompt,
  onResetSystemPromptForm,
}: PersonaDrawerProps) {
  if (!open) return null

  return (
    <div className="drawer-card persona-drawer">
      <div className="drawer-head persona-head">
        <div>
          <div className="eyebrow">キャラクター / プロンプト</div>
          <h3>Conversation Persona</h3>
          <p className="sub small">
            会話調で150字以内に収まるようにシステムプロンプトを固定しています。キャラクターを登録すると自動で反映されます。
          </p>
        </div>
        <div className="drawer-head-actions">
          <span className="pill pill-soft">150文字以内</span>
          <button className="ghost" onClick={onClose}>
            収納
          </button>
        </div>
      </div>
      <div className="persona-grid">
        <div className="persona-list">
          <div className={`persona-card ${activeCharacterId === null ? 'active' : ''}`}>
            <div className="card-head">
              <div>
                <div className="eyebrow">デフォルト</div>
                <h4>キャラクターなし</h4>
              </div>
              <button className="ghost" onClick={() => onSelectCharacter(null)} disabled={activeCharacterId === null}>
                適用
              </button>
            </div>
            <p className="mono small persona-text">
              会話調で150字以内の短い返答。コンテキストがあれば要点だけ取り込みます。
            </p>
          </div>
          {characterLoading ? <p className="hint">キャラクターを読み込み中...</p> : null}
          {!characterLoading && characters.length === 0 ? (
            <p className="hint">登録済みのキャラクターがありません。右のフォームから追加できます。</p>
          ) : null}
          {characters.map((character) => (
            <div key={character.id} className={`persona-card ${activeCharacterId === character.id ? 'active' : ''}`}>
              <div className="card-head">
                <div>
                  <div className="eyebrow">ID {character.id}</div>
                  <h4>{character.name}</h4>
                </div>
                <div className="pill pill-soft">更新 {new Date(character.updatedAt).toLocaleDateString()}</div>
              </div>
              <p className="mono small persona-text">{character.persona}</p>
              {character.speakingStyle ? <p className="mono small persona-text faint">話し方: {character.speakingStyle}</p> : null}
              <div className="card-actions">
                <button onClick={() => onSelectCharacter(character.id)} disabled={activeCharacterId === character.id}>
                  このキャラを使う
                </button>
                <button onClick={() => onStartEditCharacter(character)} className="ghost">
                  編集
                </button>
                <button
                  onClick={() => onDeleteCharacter(character.id)}
                  className="ghost danger"
                  disabled={characterDeletingId === character.id}
                >
                  {characterDeletingId === character.id ? '削除中...' : '削除'}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="persona-form">
          <div className="eyebrow">作成 / 更新</div>
          <h4>{characterEditingId ? `編集: ${characterForm.name}` : '新規キャラクター'}</h4>
          <div className="field">
            <label>名前</label>
            <input
              value={characterForm.name}
              onChange={(e) => onChangeCharacterForm('name', e.target.value)}
              placeholder="例: 明るい秘書 / 落ち着いた案内役"
            />
          </div>
          <div className="field">
            <label>人物像・役割</label>
            <textarea
              value={characterForm.persona}
              onChange={(e) => onChangeCharacterForm('persona', e.target.value)}
              rows={3}
              placeholder="例: 元気でテンポが良い。問いの意図を汲み、余計な枕詞は避ける。"
            />
          </div>
          <div className="field">
            <label>話し方のヒント（任意）</label>
            <textarea
              value={characterForm.speakingStyle}
              onChange={(e) => onChangeCharacterForm('speakingStyle', e.target.value)}
              rows={2}
              placeholder="例: 言い切り口調。数字は具体的に、敬語は簡潔に。"
            />
          </div>
          {characterError ? <p className="error-text">{characterError}</p> : null}
          <div className="actions">
            <button onClick={onSaveCharacter} disabled={characterSaving}>
              {characterSaving ? '保存中...' : '保存して適用'}
            </button>
            <button onClick={onResetCharacterForm} className="ghost">
              新規作成にリセット
            </button>
          </div>
          <p className="hint">
            デフォルトプロンプト: 会話調で150字以内の応答を徹底。ここで登録した人物像と話し方はシステムプロンプトに追加されます。
          </p>
        </div>
      </div>
      <div className="prompt-grid">
        <div>
          <div className="eyebrow">システムプロンプト一覧</div>
          {systemPromptLoading ? <p className="hint">読み込み中...</p> : null}
          {!systemPromptLoading && systemPrompts.length === 0 ? (
            <div className="persona-card">
              <div className="card-head">
                <div>
                  <div className="eyebrow">デフォルト</div>
                  <h4>保存済みプロンプトなし</h4>
                </div>
              </div>
              <p className="mono small persona-text">{defaultSystemPrompt}</p>
            </div>
          ) : null}
          {systemPrompts.map((prompt) => (
            <div key={prompt.id} className={`persona-card ${prompt.isActive ? 'active' : ''}`}>
              <div className="card-head">
                <div>
                  <div className="eyebrow">ID {prompt.id}</div>
                  <h4>{prompt.title}</h4>
                </div>
                {prompt.isActive ? <span className="pill pill-soft">active</span> : null}
              </div>
              <p className="mono small persona-text">{prompt.content}</p>
              <div className="card-actions">
                <button onClick={() => onStartEditSystemPrompt(prompt)} className="ghost">
                  編集
                </button>
                {!prompt.isActive ? <button onClick={() => onSetActiveSystemPrompt(prompt.id)}>これを適用</button> : null}
                <button
                  onClick={() => onDeleteSystemPrompt(prompt.id)}
                  className="ghost danger"
                  disabled={systemPromptDeletingId === prompt.id}
                >
                  {systemPromptDeletingId === prompt.id ? '削除中...' : '削除'}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="persona-form">
          <div className="eyebrow">システムプロンプトの作成 / 更新</div>
          <h4>{systemPromptEditingId ? `編集: ${systemPromptForm.title}` : '新規プロンプト'}</h4>
          <div className="field">
            <label>タイトル</label>
            <input
              value={systemPromptForm.title}
              onChange={(e) => onChangeSystemPromptForm('title', e.target.value)}
              placeholder="例: フレンドリー / 簡潔回答"
            />
          </div>
          <div className="field">
            <label>本文</label>
            <textarea
              value={systemPromptForm.content}
              onChange={(e) => onChangeSystemPromptForm('content', e.target.value)}
              rows={4}
              placeholder={defaultSystemPrompt}
            />
          </div>
          <div className="field inline-checkbox">
            <label className="inline">
              <input
                type="checkbox"
                checked={systemPromptForm.isActive}
                onChange={(e) => onChangeSystemPromptForm('isActive', e.target.checked)}
              />
              <span>これを適用状態にする</span>
            </label>
          </div>
          {systemPromptError ? <p className="error-text">{systemPromptError}</p> : null}
          <div className="actions">
            <button onClick={onSaveSystemPrompt} disabled={systemPromptSaving}>
              {systemPromptSaving ? '保存中...' : '保存'}
            </button>
            <button onClick={onResetSystemPromptForm} className="ghost">
              新規作成にリセット
            </button>
          </div>
          <p className="hint">
            保存済みのプロンプトを active にすると、LLM のシステムプロンプトとして利用されます。未設定時はデフォルト文を使用。
          </p>
        </div>
      </div>
    </div>
  )
}
