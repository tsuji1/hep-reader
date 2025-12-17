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
  const [editAiContext, setEditAiContext] = useState<string>('')
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [uploadingCover, setUploadingCover] = useState<boolean>(false)
  const [urlInput, setUrlInput] = useState<string>('')
  const [savingUrl, setSavingUrl] = useState<boolean>(false)
  // 複数ページ登録モーダル
  const [showMultiPageModal, setShowMultiPageModal] = useState<boolean>(false)
  const [multiPageUrl, setMultiPageUrl] = useState<string>('')
  const [linkClass, setLinkClass] = useState<string>('')
  const [ignorePaths, setIgnorePaths] = useState<string>('')
  const [maxPages, setMaxPages] = useState<number>(50)
  const [savingMultiPage, setSavingMultiPage] = useState<boolean>(false)
  const [multiPageProgress, setMultiPageProgress] = useState<string>('')
  // タグ機能
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([])
  const [bookTags, setBookTags] = useState<Record<string, Tag[]>>({})
  const [newTagName, setNewTagName] = useState<string>('')
  const [newTagColor, setNewTagColor] = useState<string>('#667eea')
  const [showTagManager, setShowTagManager] = useState<boolean>(false)
  // 編集モーダル用タグ
  const [editBookTags, setEditBookTags] = useState<Tag[]>([])
  // ページネーション
  const [currentLibraryPage, setCurrentLibraryPage] = useState<number>(1)
  const BOOKS_PER_PAGE = 10
  // タイプフィルター
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('all')
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
    if (!file || !['epub', 'pdf', 'md', 'zip'].includes(ext || '')) {
      alert('EPUB、PDF、Markdown、またはZIPファイルを選択してください')
      return
    }

    setUploading(true)
    setUploadProgress('アップロード中...')

    const formData = new FormData()
    formData.append('file', file)

    try {
      const progressMsg = ext === 'pdf' ? '保存中...'
        : ext === 'md' || ext === 'zip' ? 'Markdown変換中...'
          : '変換中...'
      setUploadProgress(progressMsg)
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

  // Handle folder upload (multiple markdown files)
  const handleFolderUpload = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return

    // Filter markdown files and images
    const mdFiles: File[] = []
    const imageFiles: File[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (ext === 'md') {
        mdFiles.push(file)
      } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext || '')) {
        imageFiles.push(file)
      }
    }

    if (mdFiles.length === 0) {
      alert('Markdownファイルが見つかりません')
      return
    }

    setUploading(true)
    setUploadProgress(`${mdFiles.length}個のMarkdownファイルを処理中...`)

    try {
      // Create a ZIP from the files and upload
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()

      // Add markdown files
      for (const file of mdFiles) {
        const content = await file.text()
        zip.file(file.name, content)
      }

      // Add image files
      for (const file of imageFiles) {
        const arrayBuffer = await file.arrayBuffer()
        zip.file(file.name, arrayBuffer)
      }

      // Generate ZIP
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const zipFile = new File([zipBlob], 'folder-upload.zip', { type: 'application/zip' })

      const formData = new FormData()
      formData.append('file', zipFile)

      setUploadProgress('変換中...')
      const res = await axios.post<{ bookId: string; bookType: string }>('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })

      setUploadProgress('完了!')
      fetchBooks()

      setTimeout(() => {
        navigate(`/read/${res.data.bookId}`)
      }, 500)
    } catch (error: unknown) {
      console.error('Folder upload failed:', error)
      const axiosError = error as { response?: { data?: { error?: string } } }
      alert(axiosError.response?.data?.error || 'フォルダのアップロードに失敗しました')
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

  // Save Multi-page URL
  const handleSaveMultiPageUrl = async (): Promise<void> => {
    if (!multiPageUrl.trim() || !linkClass.trim()) {
      alert('URLとリンクのクラス名を入力してください')
      return
    }

    setSavingMultiPage(true)
    setMultiPageProgress('ページを取得中...')
    try {
      const ignorePathsArray = ignorePaths
        .split('\n')
        .map(p => p.trim())
        .filter(p => p.length > 0)

      const res = await axios.post<{
        bookId: string
        title: string
        totalPages: number
        crawledUrls: string[]
      }>('/api/save-multipage-url', {
        url: multiPageUrl.trim(),
        linkClass: linkClass.trim(),
        ignorePaths: ignorePathsArray,
        maxPages
      })

      setMultiPageProgress(`完了! ${res.data.totalPages}ページを保存しました`)
      fetchBooks()

      // Close modal and navigate after a short delay
      setTimeout(() => {
        setShowMultiPageModal(false)
        setMultiPageUrl('')
        setLinkClass('')
        setIgnorePaths('')
        setMaxPages(50)
        setMultiPageProgress('')
        navigate(`/read/${res.data.bookId}`)
      }, 1500)
    } catch (error: unknown) {
      console.error('Save multi-page URL failed:', error)
      const axiosError = error as { response?: { data?: { error?: string } } }
      alert(axiosError.response?.data?.error || '複数ページの保存に失敗しました')
      setMultiPageProgress('')
    } finally {
      setSavingMultiPage(false)
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

  // Filter by tags (AND condition)
  const tagFilteredBooks = selectedTagFilters.length > 0
    ? sortedBooks.filter(book =>
      selectedTagFilters.every(tagId => bookTags[book.id]?.some(t => t.id === tagId))
    )
    : sortedBooks

  // Filter by type (EPUB/PDF/WEB)
  const filteredBooks = selectedTypeFilter === 'all'
    ? tagFilteredBooks
    : tagFilteredBooks.filter(book => book.book_type === selectedTypeFilter)

  // Pagination
  const totalLibraryPages = Math.ceil(filteredBooks.length / BOOKS_PER_PAGE)
  const paginatedBooks = filteredBooks.slice(
    (currentLibraryPage - 1) * BOOKS_PER_PAGE,
    currentLibraryPage * BOOKS_PER_PAGE
  )

  // Reset to page 1 when filter changes
  useEffect(() => {
    setCurrentLibraryPage(1)
  }, [selectedTagFilters, selectedTypeFilter, sortBy])

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
    setEditAiContext(book.ai_context || '')
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

  // 個別の本を積読タグに追加
  const addToTsundoku = async (e: MouseEvent, bookId: string): Promise<void> => {
    e.stopPropagation()
    const tsundokuTag = allTags.find(t => t.name === '積読')
    if (!tsundokuTag) {
      alert('積読タグが見つかりません。ページを再読み込みしてください。')
      return
    }

    // すでに積読タグがついている場合は削除
    const hasTsundoku = bookTags[bookId]?.some(t => t.id === tsundokuTag.id)

    try {
      if (hasTsundoku) {
        await axios.delete(`/api/books/${bookId}/tags/${tsundokuTag.id}`)
      } else {
        await axios.post(`/api/books/${bookId}/tags`, { tagId: tsundokuTag.id })
      }
      // bookTagsを更新
      setBookTags(prev => ({
        ...prev,
        [bookId]: hasTsundoku
          ? prev[bookId].filter(t => t.id !== tsundokuTag.id)
          : [...(prev[bookId] || []), tsundokuTag]
      }))
    } catch (error) {
      console.error('Failed to toggle tsundoku:', error)
    }
  }

  // 読了完了にする
  const markAsComplete = async (e: MouseEvent, book: Book): Promise<void> => {
    e.stopPropagation()
    const totalPages = book.book_type === 'pdf' ? book.pdf_total_pages : book.total_pages
    if (!totalPages) return

    try {
      await axios.post(`/api/books/${book.id}/progress`, { currentPage: totalPages })
      fetchBooks()
    } catch (error) {
      console.error('Failed to mark as complete:', error)
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
        language: editLanguage,
        ai_context: editAiContext
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
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link to="/">
            <h1>📚 EPUB Viewer</h1>
          </Link>
          <Link to="/settings" className="settings-link" title="設定">
            ⚙️
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
              accept=".epub,.pdf,.md,.zip"
              onChange={handleFileSelect}
              disabled={uploading}
            />
            <input
              id="folder-input"
              type="file"
              // @ts-expect-error - webkitdirectory is not in standard HTML attributes
              webkitdirectory=""
              multiple
              onChange={(e) => handleFolderUpload(e.target.files)}
              disabled={uploading}
              style={{ display: 'none' }}
            />
            {uploading ? (
              <>
                <div className="upload-icon">⏳</div>
                <p>{uploadProgress}</p>
              </>
            ) : (
              <>
                <div className="upload-icon">📖</div>
                <p>EPUB / PDF / Markdown / ZIPファイルをドロップ、またはクリックして選択</p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '10px' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      document.getElementById('folder-input')?.click()
                    }}
                    style={{
                      padding: '8px 16px',
                      background: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.85rem'
                    }}
                  >
                    📁 フォルダを選択
                  </button>
                </div>
                <p className="hint" style={{ marginTop: '10px' }}>
                  EPUB/PDFはそのまま表示 | Markdown/ZIPはHTMLに変換 | フォルダ選択でMD+画像を一括登録
                </p>
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
              <button
                type="button"
                onClick={() => setShowMultiPageModal(true)}
                className="url-save-btn"
                style={{ marginLeft: '8px', background: '#10b981' }}
                title="複数ページを連結して保存"
              >
                📑 複数ページ
              </button>
            </div>
            <p className="hint" style={{ marginTop: '8px', textAlign: 'center' }}>
              Webページの本文と画像を保存してオフラインで閲覧 | 「複数ページ」で連続ページを連結保存
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

          {/* タイプフィルター */}
          <div style={{ marginBottom: '15px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: '#666', fontSize: '0.9rem' }}>種類:</span>
            {[
              { value: 'all', label: 'すべて', color: '#667eea' },
              { value: 'epub', label: '📖 EPUB', color: '#667eea' },
              { value: 'pdf', label: '📄 PDF', color: '#ef4444' },
              { value: 'website', label: '🌐 WEB', color: '#10b981' },
              { value: 'markdown', label: '📝 MD', color: '#8b5cf6' }
            ].map(type => (
              <button
                key={type.value}
                onClick={() => setSelectedTypeFilter(type.value)}
                style={{
                  padding: '4px 12px',
                  border: 'none',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  background: selectedTypeFilter === type.value ? type.color : '#e2e8f0',
                  color: selectedTypeFilter === type.value ? 'white' : '#333'
                }}
              >
                {type.label}
              </button>
            ))}
          </div>

          {/* タグフィルタ (AND検索: 複数選択可能) */}
          {allTags.length > 0 && (
            <div style={{ marginBottom: '20px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ color: '#666', fontSize: '0.9rem' }}>タグで絞り込み:</span>
              <button
                onClick={() => setSelectedTagFilters([])}
                style={{
                  padding: '4px 12px',
                  border: 'none',
                  borderRadius: '20px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  background: selectedTagFilters.length === 0 ? '#667eea' : '#e2e8f0',
                  color: selectedTagFilters.length === 0 ? 'white' : '#333'
                }}
              >
                すべて
              </button>
              {allTags.map(tag => {
                const isSelected = selectedTagFilters.includes(tag.id)
                return (
                  <button
                    key={tag.id}
                    onClick={() => setSelectedTagFilters(prev =>
                      isSelected
                        ? prev.filter(id => id !== tag.id)
                        : [...prev, tag.id]
                    )}
                    style={{
                      padding: '4px 12px',
                      border: isSelected ? '2px solid ' + tag.color : 'none',
                      borderRadius: '20px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      background: isSelected ? tag.color : '#e2e8f0',
                      color: isSelected ? 'white' : '#333'
                    }}
                  >
                    {isSelected && '✓ '}{tag.name}
                  </button>
                )
              })}
              {selectedTagFilters.length > 1 && (
                <span style={{ color: '#666', fontSize: '0.8rem', marginLeft: '8px' }}>
                  (AND検索: {selectedTagFilters.length}個のタグ)
                </span>
              )}
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
            <>
              <div className="book-list">
                {paginatedBooks.map((book) => {
                  const hasTsundoku = bookTags[book.id]?.some(t => t.name === '積読')
                  return (
                    <div
                      key={book.id}
                      className="book-card"
                      onClick={() => openBook(book)}
                    >
                      {/* 読了完了ボタン */}
                      {getProgress(book) < 100 && (
                        <button
                          className="complete-btn"
                          onClick={(e) => markAsComplete(e, book)}
                          title="読了完了にする"
                          style={{
                            position: 'absolute',
                            bottom: '8px',
                            right: '48px',
                            zIndex: 10,
                            background: 'rgba(255,255,255,0.9)',
                            border: 'none',
                            borderRadius: '50%',
                            width: '32px',
                            height: '32px',
                            cursor: 'pointer',
                            fontSize: '1rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                            opacity: 0,
                            transition: 'opacity 0.2s'
                          }}
                        >
                          ✅
                        </button>
                      )}
                      <button
                        className="tsundoku-btn"
                        onClick={(e) => addToTsundoku(e, book.id)}
                        title={hasTsundoku ? '積読から削除' : '積読に追加'}
                        style={{
                          position: 'absolute',
                          bottom: '8px',
                          right: '8px',
                          zIndex: 10,
                          background: hasTsundoku ? '#f59e0b' : 'rgba(255,255,255,0.9)',
                          border: 'none',
                          borderRadius: '50%',
                          width: '32px',
                          height: '32px',
                          cursor: 'pointer',
                          fontSize: '1rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                        }}
                      >
                        {hasTsundoku ? '✓' : '📖'}
                      </button>
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
                          {book.book_type === 'pdf' ? '📄'
                            : book.book_type === 'website' ? '🌐'
                              : book.book_type === 'markdown' ? '📝'
                                : '📖'}
                        </div>
                        {/* 左上にタイプバッジ */}
                        <div
                          className="book-type-badge"
                          style={{
                            background: book.book_type === 'pdf' ? '#ef4444'
                              : book.book_type === 'website' ? '#10b981'
                                : book.book_type === 'markdown' ? '#8b5cf6'
                                  : '#667eea'
                          }}
                        >
                          {book.book_type === 'pdf' ? 'PDF'
                            : book.book_type === 'website' ? 'WEB'
                              : book.book_type === 'markdown' ? 'MD'
                                : 'EPUB'}
                        </div>
                      </div>
                      <div className="book-info">
                        <h3>{book.title}</h3>
                        <div className="meta">
                          {book.book_type === 'pdf'
                            ? `PDF${book.pdf_total_pages ? ` • ${book.pdf_total_pages}ページ` : ''}`
                            : book.book_type === 'website'
                              ? 'Webページ'
                              : book.book_type === 'markdown'
                                ? `Markdown • ${book.total_pages}ページ`
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
                  )
                })}
              </div>

              {/* Pagination */}
              {totalLibraryPages > 1 && (
                <div className="pagination">
                  <button
                    onClick={() => setCurrentLibraryPage(p => Math.max(1, p - 1))}
                    disabled={currentLibraryPage === 1}
                  >
                    ← 前へ
                  </button>
                  <span className="page-info">
                    {currentLibraryPage} / {totalLibraryPages} ページ
                    <span className="total-count">（全{filteredBooks.length}冊）</span>
                  </span>
                  <button
                    onClick={() => setCurrentLibraryPage(p => Math.min(totalLibraryPages, p + 1))}
                    disabled={currentLibraryPage === totalLibraryPages}
                  >
                    次へ →
                  </button>
                </div>
              )}
            </>
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
                    {tag.name !== '積読' && (
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
                    )}
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

            {/* AI用事前説明 */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '0.9rem' }}>
                🤖 AI用事前説明
              </label>
              <textarea
                value={editAiContext}
                onChange={(e) => setEditAiContext(e.target.value)}
                placeholder="この本についてAIに伝えておきたい情報を入力してください（例：セキュリティの技術書、著者は○○、主にクラウドセキュリティについて書かれている等）"
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                  resize: 'vertical'
                }}
              />
              <p style={{ fontSize: '0.8rem', color: '#888', marginTop: '5px' }}>
                ※ AIに質問する際にこの説明が毎回送信されます
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

      {/* 複数ページ登録モーダル */}
      {showMultiPageModal && (
        <div className="modal-overlay" onClick={() => !savingMultiPage && setShowMultiPageModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <h3>📑 複数ページを連結して保存</h3>
            <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '20px' }}>
              「次のページ」リンクを辿って複数ページを連結保存します。
            </p>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '0.9rem' }}>
                🔗 開始URL <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="url"
                value={multiPageUrl}
                onChange={(e) => setMultiPageUrl(e.target.value)}
                placeholder="https://example.com/page1"
                disabled={savingMultiPage}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '1rem'
                }}
              />
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '0.9rem' }}>
                🏷️ 次ページリンクのクラス名 <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={linkClass}
                onChange={(e) => setLinkClass(e.target.value)}
                placeholder="例: next-page, pagination-next, next"
                disabled={savingMultiPage}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '1rem'
                }}
              />
              <p style={{ fontSize: '0.8rem', color: '#888', marginTop: '5px' }}>
                「次のページ」リンクに付いているCSSクラス名を指定
              </p>
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '0.9rem' }}>
                🚫 無視するパス（1行に1つ）
              </label>
              <textarea
                value={ignorePaths}
                onChange={(e) => setIgnorePaths(e.target.value)}
                placeholder={`例:\n/api.html\n/about\n/contact\n*.pdf`}
                disabled={savingMultiPage}
                rows={4}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                  resize: 'vertical'
                }}
              />
              <p style={{ fontSize: '0.8rem', color: '#888', marginTop: '5px' }}>
                このパスを含むURLは無視されます。*でワイルドカード指定可能
              </p>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '0.9rem' }}>
                📄 最大ページ数
              </label>
              <input
                type="number"
                value={maxPages}
                onChange={(e) => setMaxPages(Math.max(1, Math.min(200, parseInt(e.target.value) || 50)))}
                min={1}
                max={200}
                disabled={savingMultiPage}
                style={{
                  width: '100px',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '1rem'
                }}
              />
              <span style={{ marginLeft: '10px', color: '#666', fontSize: '0.9rem' }}>ページ（最大200）</span>
            </div>

            {multiPageProgress && (
              <div style={{
                marginBottom: '20px',
                padding: '12px',
                background: multiPageProgress.includes('完了') ? '#dcfce7' : '#f0f9ff',
                borderRadius: '6px',
                color: multiPageProgress.includes('完了') ? '#166534' : '#0369a1',
                textAlign: 'center'
              }}>
                {multiPageProgress.includes('完了') ? '✅' : '⏳'} {multiPageProgress}
              </div>
            )}

            <div className="buttons">
              <button
                className="secondary"
                onClick={() => setShowMultiPageModal(false)}
                disabled={savingMultiPage}
              >
                キャンセル
              </button>
              <button
                className="primary"
                onClick={handleSaveMultiPageUrl}
                disabled={savingMultiPage || !multiPageUrl.trim() || !linkClass.trim()}
                style={{ background: '#10b981' }}
              >
                {savingMultiPage ? '取得中...' : '連結して保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Home
