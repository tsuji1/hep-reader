import axios from 'axios'
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Book, Tag } from '../types'

type SortBy = 'lastRead' | 'title' | 'added'

function Home(): JSX.Element {
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [uploading, setUploading] = useState<boolean>(false)
  const [uploadProgress, setUploadProgress] = useState<string>('')
  const [dragging, setDragging] = useState<boolean>(false)
  const [sortBy, setSortBy] = useState<SortBy>('lastRead')
  const [editingBook, setEditingBook] = useState<Book | null>(null)
  const [editTitle, setEditTitle] = useState<string>('')
  const [editLanguage, setEditLanguage] = useState<string>('en')
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [uploadingCover, setUploadingCover] = useState<boolean>(false)
  const [urlInput, setUrlInput] = useState<string>('')
  const [savingUrl, setSavingUrl] = useState<boolean>(false)
  // タグ機能
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null)
  const [bookTags, setBookTags] = useState<Record<string, Tag[]>>({})
  const [newTagName, setNewTagName] = useState<string>('')
  const [newTagColor, setNewTagColor] = useState<string>('#667eea')
  const [showTagManager, setShowTagManager] = useState<boolean>(false)
  // 編集モーダル用タグ
  const [editBookTags, setEditBookTags] = useState<Tag[]>([])
  const coverInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    fetchBooks()
    fetchTags()
  }, [])

  const fetchBooks = async (): Promise<void> => {
    try {
      const res = await axios.get<Book[]>('/api/books')
      setBooks(res.data)
      // 各本のタグを取得
      const tagsMap: Record<string, Tag[]> = {}
      for (const book of res.data) {
        try {
          const tagRes = await axios.get<Tag[]>(`/api/books/${book.id}/tags`)
          tagsMap[book.id] = tagRes.data
        } catch {
          tagsMap[book.id] = []
        }
      }
      setBookTags(tagsMap)
    } catch (error) {
      console.error('Failed to fetch books:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTags = async (): Promise<void> => {
    try {
      const res = await axios.get<Tag[]>('/api/tags')
      setAllTags(res.data)
    } catch (error) {
      console.error('Failed to fetch tags:', error)
    }
  }

  const handleUpload = async (file: File | undefined): Promise<void> => {
    const ext = file?.name.split('.').pop()?.toLowerCase()
    if (!file || !['epub', 'pdf'].includes(ext || '')) {
      alert('EPUBまたはPDFファイルを選択してください')
      return
    }

    setUploading(true)
    setUploadProgress('アップロード中...')

    const formData = new FormData()
    formData.append('file', file)

    try {
      setUploadProgress(ext === 'pdf' ? '保存中...' : '変換中...')
      const res = await axios.post<{ bookId: string; bookType: string }>('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      
      setUploadProgress('完了!')
      fetchBooks()
      
      // Navigate to reader or PDF viewer
      setTimeout(() => {
        if (res.data.bookType === 'pdf') {
          navigate(`/pdf/${res.data.bookId}`)
        } else {
          navigate(`/read/${res.data.bookId}`)
        }
      }, 500)
    } catch (error: unknown) {
      console.error('Upload failed:', error)
      const axiosError = error as { response?: { data?: { error?: string } } }
      alert(axiosError.response?.data?.error || 'アップロードに失敗しました')
    } finally {
      setUploading(false)
      setUploadProgress('')
    }
  }

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
  }

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleUpload(file)
  }, [])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDragging(false)
  }, [])

  const handleDelete = async (e: MouseEvent, bookId: string): Promise<void> => {
    e.stopPropagation()
    if (!confirm('この本を削除しますか？')) return

    try {
      await axios.delete(`/api/books/${bookId}`)
      fetchBooks()
    } catch (error) {
      console.error('Delete failed:', error)
      alert('削除に失敗しました')
    }
  }

  // Save URL
  const handleSaveUrl = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (!urlInput.trim()) return

    setSavingUrl(true)
    try {
      const res = await axios.post<{ bookId: string; title: string }>('/api/save-url', {
        url: urlInput.trim()
      })
      setUrlInput('')
      fetchBooks()
      // Navigate to the saved page
      navigate(`/read/${res.data.bookId}`)
    } catch (error: unknown) {
      console.error('Save URL failed:', error)
      const axiosError = error as { response?: { data?: { error?: string } } }
      alert(axiosError.response?.data?.error || 'URLの保存に失敗しました')
    } finally {
      setSavingUrl(false)
    }
  }

  // Sort books based on selected option
  const sortedBooks = [...books].sort((a, b) => {
    switch (sortBy) {
      case 'title':
        return a.title.localeCompare(b.title, 'ja')
      case 'added':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      case 'lastRead':
      default:
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    }
  })

  // Filter by tag
  const filteredBooks = selectedTagFilter
    ? sortedBooks.filter(book => bookTags[book.id]?.some(t => t.id === selectedTagFilter))
    : sortedBooks

  // Open book
  const openBook = (book: Book): void => {
    if (book.book_type === 'pdf') {
      navigate(`/pdf/${book.id}`)
    } else {
      navigate(`/read/${book.id}`)
    }
  }

  // Open edit modal
  const openEditModal = async (e: MouseEvent, book: Book): Promise<void> => {
    e.stopPropagation()
    setEditingBook(book)
    setEditTitle(book.title)
    setEditLanguage(book.language || 'en')
    setCoverPreview(null)
    setCoverFile(null)
    // 本のタグを読み込み
    try {
      const res = await axios.get<Tag[]>(`/api/books/${book.id}/tags`)
      setEditBookTags(res.data)
    } catch {
      setEditBookTags([])
    }
  }

  // タグ管理
  const createTag = async (): Promise<void> => {
    if (!newTagName.trim()) return
    try {
      await axios.post('/api/tags', { name: newTagName.trim(), color: newTagColor })
      setNewTagName('')
      setNewTagColor('#667eea')
      fetchTags()
    } catch (error: unknown) {
      const axiosError = error as { response?: { data?: { error?: string } } }
      alert(axiosError.response?.data?.error || 'タグの作成に失敗しました')
    }
  }

  const deleteTagHandler = async (tagId: string): Promise<void> => {
    if (!confirm('このタグを削除しますか？')) return
    try {
      await axios.delete(`/api/tags/${tagId}`)
      fetchTags()
      fetchBooks()
    } catch (error) {
      console.error('Failed to delete tag:', error)
    }
  }

  const toggleBookTag = async (tagId: string): Promise<void> => {
    if (!editingBook) return
    const hasTag = editBookTags.some(t => t.id === tagId)
    try {
      if (hasTag) {
        await axios.delete(`/api/books/${editingBook.id}/tags/${tagId}`)
        setEditBookTags(editBookTags.filter(t => t.id !== tagId))
      } else {
        await axios.post(`/api/books/${editingBook.id}/tags`, { tagId })
        const tag = allTags.find(t => t.id === tagId)
        if (tag) setEditBookTags([...editBookTags, tag])
      }
      // bookTagsも更新
      setBookTags(prev => ({
        ...prev,
        [editingBook.id]: hasTag
          ? prev[editingBook.id].filter(t => t.id !== tagId)
          : [...(prev[editingBook.id] || []), allTags.find(t => t.id === tagId)!]
      }))
    } catch (error) {
      console.error('Failed to toggle tag:', error)
    }
  }

  // Progress calculation helper
  const getProgress = (book: Book): number => {
    if (book.book_type === 'pdf') {
      // PDFの場合はpdf_total_pagesを使用、ない場合は0%
      if (!book.pdf_total_pages) return 0
      return ((book.current_page || 1) / book.pdf_total_pages) * 100
    }
    return ((book.current_page || 1) / book.total_pages) * 100
  }

  // Handle cover image selection
  const handleCoverSelect = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('image/')) {
        alert('画像ファイルを選択してください')
        return
      }
      setCoverFile(file)
      const reader = new FileReader()
      reader.onload = (e) => setCoverPreview(e.target?.result as string)
      reader.readAsDataURL(file)
    }
  }

  // Reset cover to original
  const handleResetCover = async (): Promise<void> => {
    if (!editingBook) return
    if (!confirm('カバー画像を元に戻しますか？')) return
    
    try {
      await axios.delete(`/api/books/${editingBook.id}/cover`)
      setCoverPreview(null)
      setCoverFile(null)
      fetchBooks()
    } catch (error) {
      console.error('Failed to reset cover:', error)
      alert('カバーのリセットに失敗しました')
    }
  }

  // Save book edits
  const saveBookEdit = async (): Promise<void> => {
    if (!editingBook) return
    
    setUploadingCover(true)
    try {
      // Upload cover if changed
      if (coverFile) {
        const formData = new FormData()
        formData.append('cover', coverFile)
        await axios.post(`/api/books/${editingBook.id}/cover`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
      }
      
      // Update book info
      await axios.patch(`/api/books/${editingBook.id}`, {
        title: editTitle,
        language: editLanguage
      })
      fetchBooks()
      setEditingBook(null)
      setCoverPreview(null)
      setCoverFile(null)
    } catch (error) {
      console.error('Failed to update book:', error)
      alert('更新に失敗しました')
    } finally {
      setUploadingCover(false)
    }
  }

  return (
    <div>
      <header className="header">
        <div className="container">
          <Link to="/">
            <h1>📚 EPUB Viewer</h1>
          </Link>
        </div>
      </header>

      <main className="container">
        <section className="upload-section">
          <div
            className={`upload-zone ${dragging ? 'dragging' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <input
              id="file-input"
              type="file"
              accept=".epub,.pdf"
              onChange={handleFileSelect}
              disabled={uploading}
            />
            {uploading ? (
              <>
                <div className="upload-icon">⏳</div>
                <p>{uploadProgress}</p>
              </>
            ) : (
              <>
                <div className="upload-icon">📖</div>
                <p>EPUB / PDFファイルをドロップ、またはクリックして選択</p>
                <p className="hint">EPUBはHTMLに変換、PDFはそのまま表示</p>
              </>
            )}
          </div>

          {/* URL Input Section */}
          <form onSubmit={handleSaveUrl} className="url-input-section">
            <div className="url-input-wrapper">
              <span className="url-icon">🌐</span>
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="WebサイトのURLを入力して保存..."
                disabled={savingUrl}
                className="url-input"
              />
              <button
                type="submit"
                disabled={savingUrl || !urlInput.trim()}
                className="url-save-btn"
              >
                {savingUrl ? '保存中...' : '保存'}
              </button>
            </div>
            <p className="hint" style={{ marginTop: '8px', textAlign: 'center' }}>
              Webページの本文と画像を保存してオフラインで閲覧
            </p>
          </form>
        </section>

        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
            <h2 style={{ margin: 0, color: '#333' }}>ライブラリ</h2>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* タグ管理ボタン */}
              <button
                onClick={() => setShowTagManager(!showTagManager)}
                style={{
                  padding: '6px 12px',
                  background: '#f0f0f0',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
              >
                🏷️ タグ管理
              </button>
              <div className="sort-controls">
                <label style={{ marginRight: '8px', color: '#666', fontSize: '0.9rem' }}>並び替え:</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="sort-select"
                >
                  <option value="lastRead">最終閲覧日時</option>
                  <option value="title">タイトル順</option>
                  <option value="added">追加日時</option>
                </select>
              </div>
            </div>
          </div>

          {/* タグフィルタ */}
          {allTags.length > 0 && (
            <div style={{ marginBottom: '20px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ color: '#666', fontSize: '0.9rem' }}>タグで絞り込み:</span>
              <button
                onClick={() => setSelectedTagFilter(null)}
                className={`tag-filter-btn ${selectedTagFilter === null ? 'active' : ''}`}
                style={{
                  padding: '4px 12px',
                  border: 'none',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  background: selectedTagFilter === null ? '#667eea' : '#e2e8f0',
                  color: selectedTagFilter === null ? 'white' : '#333'
                }}
              >
                すべて
              </button>
              {allTags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => setSelectedTagFilter(selectedTagFilter === tag.id ? null : tag.id)}
                  style={{
                    padding: '4px 12px',
                    border: 'none',
                    borderRadius: '20px',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    background: selectedTagFilter === tag.id ? tag.color : '#e2e8f0',
                    color: selectedTagFilter === tag.id ? 'white' : '#333'
                  }}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}
          
          {loading ? (
            <div className="loading">読み込み中</div>
          ) : books.length === 0 ? (
            <div className="empty-state">
              <div className="icon">📚</div>
              <p>まだ本がありません</p>
              <p>EPUBファイルをアップロードして始めましょう</p>
            </div>
          ) : (
            <div className="book-list">
              {filteredBooks.map((book) => (
                <div
                  key={book.id}
                  className="book-card"
                  onClick={() => openBook(book)}
                >
                  <button
                    className="edit-btn"
                    onClick={(e) => openEditModal(e, book)}
                    title="編集"
                  >
                    ⚙
                  </button>
                  <button
                    className="delete-btn"
                    onClick={(e) => handleDelete(e, book.id)}
                    title="削除"
                  >
                    ×
                  </button>
                  <div className="book-cover">
                    <img 
                      src={`/api/books/${book.id}/cover`} 
                      alt={book.title}
                      onError={(e) => {
                        const target = e.target as HTMLImageElement
                        target.style.display = 'none'
                        target.parentElement?.classList.add('no-cover')
                      }}
                    />
                    <div className="no-cover-icon">
                      {book.book_type === 'pdf' ? '📄' : book.book_type === 'website' ? '🌐' : '📖'}
                    </div>
                    {/* 左上にタイプバッジ */}
                    <div 
                      className="book-type-badge"
                      style={{ 
                        background: book.book_type === 'pdf' ? '#ef4444' 
                                  : book.book_type === 'website' ? '#10b981' 
                                  : '#667eea' 
                      }}
                    >
                      {book.book_type === 'pdf' ? 'PDF' : book.book_type === 'website' ? 'WEB' : 'EPUB'}
                    </div>
                  </div>
                  <div className="book-info">
                    <h3>{book.title}</h3>
                    <div className="meta">
                      {book.book_type === 'pdf' 
                        ? `PDF${book.pdf_total_pages ? ` • ${book.pdf_total_pages}ページ` : ''}`
                        : book.book_type === 'website' 
                        ? 'Webページ' 
                        : `${book.total_pages}ページ`}
                      {book.current_page && book.current_page > 1 && (
                        <> • {Math.round(getProgress(book))}% 読了</>
                      )}
                    </div>
                    <div className="meta" style={{ fontSize: '0.75rem', marginTop: '4px' }}>
                      🌐 {book.language === 'ja' ? '日本語' : book.language === 'en' ? '英語' : book.language || '英語'}
                    </div>
                    {/* タグ表示 */}
                    {bookTags[book.id]?.length > 0 && (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                        {bookTags[book.id].map(tag => (
                          <span
                            key={tag.id}
                            style={{
                              padding: '2px 8px',
                              background: tag.color,
                              color: 'white',
                              borderRadius: '10px',
                              fontSize: '0.7rem'
                            }}
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="progress-bar">
                      <div
                        className="fill"
                        style={{
                          width: `${getProgress(book)}%`
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* タグ管理モーダル */}
      {showTagManager && (
        <div className="modal-overlay" onClick={() => setShowTagManager(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <h3>🏷️ タグ管理</h3>
            
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="新しいタグ名"
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    border: '1px solid #ddd',
                    borderRadius: '6px'
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && createTag()}
                />
                <input
                  type="color"
                  value={newTagColor}
                  onChange={(e) => setNewTagColor(e.target.value)}
                  style={{ width: '40px', height: '36px', border: 'none', cursor: 'pointer' }}
                />
                <button
                  onClick={createTag}
                  style={{
                    padding: '8px 16px',
                    background: '#667eea',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                >
                  追加
                </button>
              </div>
            </div>

            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {allTags.length === 0 ? (
                <p style={{ color: '#888', textAlign: 'center' }}>タグがありません</p>
              ) : (
                allTags.map(tag => (
                  <div
                    key={tag.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      background: '#f8f9fa',
                      borderRadius: '6px',
                      marginBottom: '8px'
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '50%',
                          background: tag.color
                        }}
                      />
                      {tag.name}
                    </span>
                    <button
                      onClick={() => deleteTagHandler(tag.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#dc3545'
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="buttons" style={{ marginTop: '20px' }}>
              <button className="secondary" onClick={() => setShowTagManager(false)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Book Modal */}
      {editingBook && (
        <div className="modal-overlay" onClick={() => setEditingBook(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>📚 書籍情報を編集</h3>
            
            {/* Cover Image Section */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '0.9rem' }}>
                カバー画像
              </label>
              <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
                <div 
                  style={{
                    width: '100px',
                    height: '140px',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    background: '#f0f0f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  <img 
                    src={coverPreview || `/api/books/${editingBook.id}/cover?t=${Date.now()}`}
                    alt="カバー"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                      if (target.parentElement) {
                        target.parentElement.innerHTML = '<span style="font-size: 2rem">📖</span>'
                      }
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleCoverSelect}
                    style={{ display: 'none' }}
                  />
                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    style={{
                      padding: '8px 16px',
                      background: '#667eea',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      marginBottom: '8px',
                      width: '100%'
                    }}
                  >
                    📷 画像を選択
                  </button>
                  <button
                    type="button"
                    onClick={handleResetCover}
                    style={{
                      padding: '8px 16px',
                      background: '#f0f0f0',
                      color: '#666',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      width: '100%'
                    }}
                  >
                    🔄 元に戻す
                  </button>
                  <p style={{ fontSize: '0.75rem', color: '#888', marginTop: '8px' }}>
                    PNG, JPG, GIF, WebP (最大10MB)
                  </p>
                </div>
              </div>
            </div>
            
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '0.9rem' }}>
                タイトル
              </label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '1rem'
                }}
              />
            </div>
            
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '0.9rem' }}>
                言語（翻訳の元言語）
              </label>
              <select
                value={editLanguage}
                onChange={(e) => setEditLanguage(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '1rem'
                }}
              >
                <option value="en">英語 (English)</option>
                <option value="ja">日本語</option>
                <option value="zh">中国語</option>
                <option value="ko">韓国語</option>
                <option value="de">ドイツ語</option>
                <option value="fr">フランス語</option>
                <option value="es">スペイン語</option>
              </select>
              <p style={{ fontSize: '0.8rem', color: '#888', marginTop: '5px' }}>
                ※ 自動翻訳機能で使用されます
              </p>
            </div>

            {/* タグ選択 */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '0.9rem' }}>
                🏷️ タグ
              </label>
              {allTags.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: '#888' }}>
                  タグがありません。「タグ管理」から追加してください。
                </p>
              ) : (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {allTags.map(tag => {
                    const isSelected = editBookTags.some(t => t.id === tag.id)
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleBookTag(tag.id)}
                        style={{
                          padding: '6px 14px',
                          border: isSelected ? 'none' : '2px solid #e2e8f0',
                          borderRadius: '20px',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          background: isSelected ? tag.color : 'white',
                          color: isSelected ? 'white' : '#333',
                          transition: 'all 0.2s'
                        }}
                      >
                        {isSelected ? '✓ ' : ''}{tag.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            
            <div className="buttons">
              <button className="secondary" onClick={() => setEditingBook(null)}>
                キャンセル
              </button>
              <button className="primary" onClick={saveBookEdit} disabled={uploadingCover}>
                {uploadingCover ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Home
