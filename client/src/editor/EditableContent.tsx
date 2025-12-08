import { useCallback, useEffect, useState } from 'react'
import TiptapEditor from './TiptapEditor'
import './editor.css'

interface EditableContentProps {
  content: string
  pageNum: number
  bookId: string
  onSave?: (pageNum: number, content: string) => Promise<void>
  lang?: string
  className?: string
}

/**
 * EPUB/Web用の編集可能コンテンツコンポーネント
 * - 通常はHTMLをそのまま表示
 * - 編集モードでTiptapエディタに切り替え
 */
export default function EditableContent({
  content,
  pageNum,
  bookId,
  onSave,
  lang = 'en',
  className = ''
}: EditableContentProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState(content)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  // 外部からcontentが変更された場合に反映
  useEffect(() => {
    if (!isEditing) {
      setEditedContent(content)
    }
  }, [content, isEditing])

  const handleContentChange = useCallback((html: string) => {
    setEditedContent(html)
    setHasChanges(html !== content)
  }, [content])

  const handleSave = useCallback(async () => {
    if (!onSave || !hasChanges) return

    setIsSaving(true)
    try {
      await onSave(pageNum, editedContent)
      setHasChanges(false)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to save content:', error)
      alert('保存に失敗しました')
    } finally {
      setIsSaving(false)
    }
  }, [onSave, pageNum, editedContent, hasChanges])

  const handleCancel = useCallback(() => {
    if (hasChanges && !confirm('変更を破棄しますか？')) {
      return
    }
    setEditedContent(content)
    setHasChanges(false)
    setIsEditing(false)
  }, [content, hasChanges])

  const toggleEdit = useCallback(() => {
    if (isEditing && hasChanges) {
      if (!confirm('変更を破棄しますか？')) {
        return
      }
      setEditedContent(content)
      setHasChanges(false)
    }
    setIsEditing(!isEditing)
  }, [isEditing, hasChanges, content])

  return (
    <div className={`editable-content ${className}`}>
      <button
        className={`edit-toggle ${isEditing ? 'editing' : ''}`}
        onClick={toggleEdit}
        title={isEditing ? '編集を終了' : '編集モード'}
      >
        {isEditing ? '✕ 閉じる' : '✏️ 編集'}
      </button>

      {isEditing ? (
        <div className="editable-editor-container">
          <TiptapEditor
            content={editedContent}
            onChange={handleContentChange}
            editable={true}
            placeholder="コンテンツを編集..."
            className="tiptap-inline"
          />

          {hasChanges && (
            <div className="editable-actions">
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
          )}
        </div>
      ) : (
        <div
          className="content-html clickable-images"
          lang={lang}
          dangerouslySetInnerHTML={{ __html: editedContent }}
        />
      )}
    </div>
  )
}

