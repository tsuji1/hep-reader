import axios from 'axios'
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import type { Vocabulary } from '../types'

interface VocabularyPanelProps {
  onClose: () => void
  onVocabulariesChange?: (vocabularies: Vocabulary[]) => void
}

export default function VocabularyPanel({ onClose, onVocabulariesChange }: VocabularyPanelProps): JSX.Element {
  const [vocabularies, setVocabularies] = useState<Vocabulary[]>([])
  const [loading, setLoading] = useState(true)
  const [newTerm, setNewTerm] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTerm, setEditTerm] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [importText, setImportText] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchVocabularies = useCallback(async () => {
    try {
      const res = await axios.get<Vocabulary[]>('/api/vocabularies')
      setVocabularies(res.data)
      onVocabulariesChange?.(res.data)
    } catch (err) {
      console.error('Failed to fetch vocabularies:', err)
    } finally {
      setLoading(false)
    }
  }, [onVocabulariesChange])

  useEffect(() => {
    fetchVocabularies()
  }, [fetchVocabularies])

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    if (!newTerm.trim() || !newDescription.trim()) return

    try {
      setError(null)
      await axios.post('/api/vocabularies', { term: newTerm.trim(), description: newDescription.trim() })
      setNewTerm('')
      setNewDescription('')
      fetchVocabularies()
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: string } } }
      setError(axiosError.response?.data?.error || '追加に失敗しました')
    }
  }

  const handleUpdate = async (id: string) => {
    if (!editTerm.trim() || !editDescription.trim()) return

    try {
      await axios.put(`/api/vocabularies/${id}`, { term: editTerm.trim(), description: editDescription.trim() })
      setEditingId(null)
      fetchVocabularies()
    } catch (err) {
      console.error('Failed to update vocabulary:', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この用語を削除しますか？')) return

    try {
      await axios.delete(`/api/vocabularies/${id}`)
      fetchVocabularies()
    } catch (err) {
      console.error('Failed to delete vocabulary:', err)
    }
  }

  const handleExport = async () => {
    const json = JSON.stringify(vocabularies, null, 2)
    await navigator.clipboard.writeText(json)
    alert('クリップボードにコピーしました')
  }

  const handleImport = async () => {
    try {
      const parsed = JSON.parse(importText)
      const items = Array.isArray(parsed) ? parsed : [parsed]
      await axios.post('/api/vocabularies/import', { vocabularies: items })
      setImportText('')
      setShowImport(false)
      fetchVocabularies()
      alert(`${items.length}件の用語をインポートしました`)
    } catch (err) {
      alert('インポートに失敗しました。JSONの形式を確認してください。')
    }
  }

  const startEdit = (vocab: Vocabulary) => {
    setEditingId(vocab.id)
    setEditTerm(vocab.term)
    setEditDescription(vocab.description)
  }

  return (
    <div className="vocabulary-panel">
      <div className="vocabulary-header">
        <h3>📖 用語集</h3>
        <button onClick={onClose} className="close-btn">✕</button>
      </div>

      {/* 新規追加フォーム */}
      <form onSubmit={handleAdd} className="vocabulary-add-form">
        <input
          type="text"
          placeholder="用語 (例: RAN)"
          value={newTerm}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNewTerm(e.target.value)}
        />
        <textarea
          placeholder="説明 (例: 無線レイヤの制御を行う基地局などで構成されるネットワーク)"
          value={newDescription}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNewDescription(e.target.value)}
          rows={2}
        />
        <button type="submit" disabled={!newTerm.trim() || !newDescription.trim()}>
          ➕ 追加
        </button>
        {error && <p className="error-message">{error}</p>}
      </form>

      {/* エクスポート/インポート */}
      <div className="vocabulary-actions">
        <button onClick={handleExport} className="secondary" disabled={vocabularies.length === 0}>
          📋 コピー
        </button>
        <button onClick={() => setShowImport(!showImport)} className="secondary">
          📥 インポート
        </button>
      </div>

      {showImport && (
        <div className="vocabulary-import">
          <textarea
            placeholder='JSON形式で貼り付け: [{"term": "RAN", "description": "説明..."}]'
            value={importText}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setImportText(e.target.value)}
            rows={4}
          />
          <button onClick={handleImport} disabled={!importText.trim()}>
            インポート実行
          </button>
        </div>
      )}

      {/* 用語リスト */}
      <div className="vocabulary-list">
        {loading ? (
          <p className="loading-text">読み込み中...</p>
        ) : vocabularies.length === 0 ? (
          <p className="empty-text">用語がまだ登録されていません</p>
        ) : (
          vocabularies.map(vocab => (
            <div key={vocab.id} className="vocabulary-item">
              {editingId === vocab.id ? (
                <div className="vocabulary-edit">
                  <input
                    type="text"
                    value={editTerm}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setEditTerm(e.target.value)}
                  />
                  <textarea
                    value={editDescription}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setEditDescription(e.target.value)}
                    rows={2}
                  />
                  <div className="edit-buttons">
                    <button onClick={() => handleUpdate(vocab.id)}>保存</button>
                    <button onClick={() => setEditingId(null)} className="secondary">キャンセル</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="vocabulary-content">
                    <span className="vocab-term-display">{vocab.term}</span>
                    <span className="vocab-description">{vocab.description}</span>
                  </div>
                  <div className="vocabulary-buttons">
                    <button onClick={() => startEdit(vocab)} className="edit-btn" title="編集">✏️</button>
                    <button onClick={() => handleDelete(vocab.id)} className="delete-btn" title="削除">🗑️</button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
