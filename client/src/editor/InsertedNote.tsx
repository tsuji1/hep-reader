import { useCallback, useState } from 'react'
import TiptapEditor from './TiptapEditor'
import './editor.css'

export interface NoteData {
  id: string
  bookId: string
  pageNum: number
  content: string
  position: number // ページ内での位置（順序）
  createdAt: string
  updatedAt: string
}

interface InsertedNoteProps {
  note: NoteData
  onSave: (note: NoteData) => Promise<void>
  onDelete: (noteId: string) => Promise<void>
}

/**
 * 差し込まれたノート/エディタブロック
 * PDF、EPUB、Webの任意のページに差し込めるエディタ
 */
export default function InsertedNote({
  note,
  onSave,
  onDelete
}: InsertedNoteProps) {
  const [content, setContent] = useState(note.content)
  const [isEditing, setIsEditing] = useState(!note.content) // 空の場合は編集モードで開始
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const handleContentChange = useCallback((html: string) => {
    setContent(html)
    setHasChanges(html !== note.content)
  }, [note.content])

  const handleSave = useCallback(async () => {
    if (!hasChanges && content === note.content) {
      setIsEditing(false)
      return
    }

    setIsSaving(true)
    try {
      await onSave({
        ...note,
        content,
        updatedAt: new Date().toISOString()
      })
      setHasChanges(false)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to save note:', error)
      alert('保存に失敗しました')
    } finally {
      setIsSaving(false)
    }
  }, [note, content, hasChanges, onSave])

  const handleDelete = useCallback(async () => {
    if (!confirm('このメモを削除しますか？')) return

    try {
      await onDelete(note.id)
    } catch (error) {
      console.error('Failed to delete note:', error)
      alert('削除に失敗しました')
    }
  }, [note.id, onDelete])

  const handleCancel = useCallback(() => {
    if (hasChanges && !confirm('変更を破棄しますか？')) {
      return
    }
    setContent(note.content)
    setHasChanges(false)
    setIsEditing(false)
  }, [note.content, hasChanges])

  return (
    <div className="inserted-editor">
      <div className="inserted-editor-header">
        <span className="note-label">📝 メモ</span>
        <div className="note-actions">
          {!isEditing && (
            <button onClick={() => setIsEditing(true)}>
              ✏️ 編集
            </button>
          )}
          <button onClick={handleDelete} className="delete-btn">
            🗑 削除
          </button>
        </div>
      </div>

      {isEditing ? (
        <>
          <TiptapEditor
            content={content}
            onChange={handleContentChange}
            editable={true}
            placeholder="メモを入力..."
          />
          <div className="editable-actions" style={{ padding: '12px', borderTop: '1px solid #e2e8f0' }}>
            <button
              onClick={handleCancel}
              disabled={isSaving}
              className="cancel-btn"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="save-btn"
            >
              {isSaving ? '保存中...' : '💾 保存'}
            </button>
          </div>
        </>
      ) : (
        <div
          className="inserted-note-content"
          onClick={() => setIsEditing(true)}
        >
          {content ? (
            <div dangerouslySetInnerHTML={{ __html: content }} />
          ) : (
            <p style={{ color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>
              クリックして編集...
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 新しいノートを挿入するボタン
 */
interface InsertNoteButtonProps {
  onClick: () => void
}

export function InsertNoteButton({ onClick }: InsertNoteButtonProps) {
  return (
    <button className="insert-editor-button" onClick={onClick}>
      <span className="icon">➕</span>
      メモを追加
    </button>
  )
}

