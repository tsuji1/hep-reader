import axios from 'axios'
import { useEffect, useRef, useState } from 'react'

interface AiSettingDisplay {
  provider: string
  model: string | null
  configured: boolean
}

interface Message {
  role: 'user' | 'assistant' | 'error'
  content: string
}

interface AiChatProps {
  context?: string
  onClose: () => void
}

const providerLabels: Record<string, string> = {
  gemini: 'Gemini',
  claude: 'Claude',
  openai: 'GPT'
}

function AiChat({ context, onClose }: AiChatProps): JSX.Element {
  const [settings, setSettings] = useState<AiSettingDisplay[]>([])
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchSettings()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const fetchSettings = async () => {
    try {
      const res = await axios.get<AiSettingDisplay[]>('/api/ai/settings')
      setSettings(res.data)
      // 最初に設定済みのプロバイダを選択
      const configured = res.data.find(s => s.configured)
      if (configured) {
        setSelectedProvider(configured.provider)
      }
    } catch (error) {
      console.error('Failed to fetch AI settings:', error)
    }
  }

  const isConfigured = (provider: string) => {
    return settings.some(s => s.provider === provider && s.configured)
  }

  const sendMessage = async () => {
    if (!input.trim() || !selectedProvider || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    try {
      const res = await axios.post<{ response: string }>('/api/ai/chat', {
        provider: selectedProvider,
        message: userMessage,
        context: context
      })
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.response }])
    } catch (error: any) {
      const errMsg = error.response?.data?.error || error.message || 'エラーが発生しました'
      setMessages(prev => [...prev, { role: 'error', content: errMsg }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const hasConfiguredProvider = settings.some(s => s.configured)

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-header">
        <h3>🤖 AIアシスタント</h3>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>

      {!hasConfiguredProvider ? (
        <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
          <p>APIキーが設定されていません</p>
          <a href="/settings" style={{ color: '#667eea' }}>設定画面でAPIキーを追加</a>
        </div>
      ) : (
        <>
          <div className="ai-provider-select">
            {['gemini', 'claude', 'openai'].map(provider => (
              <button
                key={provider}
                className={`${selectedProvider === provider ? 'active' : ''} ${!isConfigured(provider) ? 'unconfigured' : ''}`}
                onClick={() => isConfigured(provider) && setSelectedProvider(provider)}
                disabled={!isConfigured(provider)}
              >
                {providerLabels[provider]}
              </button>
            ))}
          </div>

          <div className="ai-chat-messages">
            {messages.length === 0 && (
              <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
                <p>📚 本の内容について質問できます</p>
                <p style={{ fontSize: '0.8rem', marginTop: '10px' }}>
                  現在のページの内容がコンテキストとして送信されます
                </p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`ai-message ${msg.role}`}>
                {msg.content}
              </div>
            ))}
            {loading && (
              <div className="ai-message assistant" style={{ opacity: 0.6 }}>
                考え中...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="ai-chat-input">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="質問を入力... (Shift+Enterで改行)"
              rows={2}
              disabled={loading || !selectedProvider}
            />
            <button 
              onClick={sendMessage} 
              disabled={loading || !input.trim() || !selectedProvider}
            >
              送信
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default AiChat
