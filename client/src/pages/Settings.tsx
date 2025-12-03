import axios from 'axios'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface AiSettingDisplay {
  provider: string
  model: string | null
  configured: boolean
}

interface ProviderConfig {
  name: string
  id: string
  defaultModel: string
  models: string[]
  color: string
}

const providers: ProviderConfig[] = [
  {
    name: 'Google Gemini',
    id: 'gemini',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro'],
    color: '#4285f4'
  },
  {
    name: 'Anthropic Claude',
    id: 'claude',
    defaultModel: 'claude-sonnet-4-20250514',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
    color: '#d97706'
  },
  {
    name: 'OpenAI ChatGPT',
    id: 'openai',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'],
    color: '#10a37f'
  }
]

function Settings(): JSX.Element {
  const [settings, setSettings] = useState<AiSettingDisplay[]>([])
  const [loading, setLoading] = useState(true)
  const [editProvider, setEditProvider] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  // Get current server URL for FreshRSS configuration
  const serverUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const freshRssShareUrl = `${serverUrl}/api/freshrss/share?url=~url~&title=~title~`

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      const res = await axios.get<AiSettingDisplay[]>('/api/ai/settings')
      setSettings(res.data)
    } catch (error) {
      console.error('Failed to fetch settings:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (providerId: string) => {
    const provider = providers.find(p => p.id === providerId)
    const existing = settings.find(s => s.provider === providerId)
    setEditProvider(providerId)
    setApiKey('')
    setSelectedModel(existing?.model || provider?.defaultModel || '')
  }

  const handleSave = async () => {
    if (!editProvider || !apiKey.trim()) return

    setSaving(true)
    try {
      await axios.post('/api/ai/settings', {
        provider: editProvider,
        apiKey: apiKey.trim(),
        model: selectedModel
      })
      await fetchSettings()
      setEditProvider(null)
      setApiKey('')
    } catch (error) {
      console.error('Failed to save setting:', error)
      alert('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (providerId: string) => {
    if (!confirm('このAPIキーを削除しますか？')) return

    try {
      await axios.delete(`/api/ai/settings/${providerId}`)
      await fetchSettings()
    } catch (error) {
      console.error('Failed to delete setting:', error)
    }
  }

  const isConfigured = (providerId: string) => {
    return settings.some(s => s.provider === providerId && s.configured)
  }

  const getConfiguredModel = (providerId: string) => {
    return settings.find(s => s.provider === providerId)?.model
  }

  if (loading) {
    return <div className="loading">読み込み中...</div>
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <Link to="/" className="back-link">← ライブラリに戻る</Link>
        <h1>⚙️ 設定</h1>
      </header>

      <section className="settings-section">
        <h2>🤖 AI設定</h2>
        <p className="settings-description">
          本を読みながらAIに質問するためのAPIキーを設定します。
          各サービスのAPIキーは各自で取得してください。
        </p>

        <div className="ai-providers">
          {providers.map(provider => (
            <div 
              key={provider.id} 
              className={`provider-card ${isConfigured(provider.id) ? 'configured' : ''}`}
              style={{ borderColor: isConfigured(provider.id) ? provider.color : undefined }}
            >
              <div className="provider-header">
                <span 
                  className="provider-name"
                  style={{ color: provider.color }}
                >
                  {provider.name}
                </span>
                {isConfigured(provider.id) && (
                  <span className="configured-badge" style={{ background: provider.color }}>
                    ✓ 設定済み
                  </span>
                )}
              </div>

              {isConfigured(provider.id) && (
                <div className="provider-model">
                  モデル: {getConfiguredModel(provider.id) || provider.defaultModel}
                </div>
              )}

              {editProvider === provider.id ? (
                <div className="provider-edit">
                  <input
                    type="password"
                    placeholder="APIキーを入力"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    autoFocus
                  />
                  <select
                    value={selectedModel}
                    onChange={e => setSelectedModel(e.target.value)}
                  >
                    {provider.models.map(model => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                  <div className="edit-buttons">
                    <button 
                      className="cancel-btn"
                      onClick={() => setEditProvider(null)}
                    >
                      キャンセル
                    </button>
                    <button 
                      className="save-btn"
                      onClick={handleSave}
                      disabled={saving || !apiKey.trim()}
                      style={{ background: provider.color }}
                    >
                      {saving ? '保存中...' : '保存'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="provider-actions">
                  <button 
                    className="edit-btn"
                    onClick={() => handleEdit(provider.id)}
                  >
                    {isConfigured(provider.id) ? '変更' : 'APIキーを設定'}
                  </button>
                  {isConfigured(provider.id) && (
                    <button 
                      className="delete-btn"
                      onClick={() => handleDelete(provider.id)}
                    >
                      削除
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>📰 FreshRSS連携</h2>
        <p className="settings-description">
          FreshRSSから記事をEPUB Viewerに送信して保存できます。
          FreshRSSの設定で以下のカスタム共有先を追加してください。
        </p>

        <div className="freshrss-config">
          <div className="config-item">
            <label>共有先名:</label>
            <div className="config-value">
              <code>EPUB Viewer</code>
              <button 
                className="copy-btn"
                onClick={() => copyToClipboard('EPUB Viewer')}
                title="コピー"
              >
                📋
              </button>
            </div>
          </div>
          
          <div className="config-item">
            <label>共有先URL:</label>
            <div className="config-value">
              <code className="url-code">{freshRssShareUrl}</code>
              <button 
                className="copy-btn"
                onClick={() => copyToClipboard(freshRssShareUrl)}
                title="コピー"
              >
                {copied ? '✓' : '📋'}
              </button>
            </div>
          </div>

          <div className="config-instructions">
            <h4>設定方法:</h4>
            <ol>
              <li>FreshRSSの設定 → 統合 → カスタム共有を開く</li>
              <li>「名前」に <code>EPUB Viewer</code> を入力</li>
              <li>「URL」に上記のURLをコピーして貼り付け</li>
              <li>保存して完了！</li>
            </ol>
            <p className="config-note">
              💡 記事を開いた状態で共有ボタンから「EPUB Viewer」を選ぶと、
              記事がライブラリに保存されます。
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

export default Settings
