import axios from 'axios'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

function Home() {
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [dragging, setDragging] = useState(false)
  const [sortBy, setSortBy] = useState('lastRead') // 'lastRead', 'title', 'added'
  const [editingBook, setEditingBook] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editLanguage, setEditLanguage] = useState('en')
  const navigate = useNavigate()

  useEffect(() => {
    fetchBooks()
  }, [])

  const fetchBooks = async () => {
    try {
      const res = await axios.get('/api/books')
      setBooks(res.data)
    } catch (error) {
      console.error('Failed to fetch books:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleUpload = async (file) => {
    if (!file || !file.name.endsWith('.epub')) {
      alert('EPUBファイルを選択してください')
      return
    }

    setUploading(true)
    setUploadProgress('アップロード中...')

    const formData = new FormData()
    formData.append('epub', file)

    try {
      setUploadProgress('変換中...')
      const res = await axios.post('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      
      setUploadProgress('完了!')
      fetchBooks()
      
      // Navigate to reader
      setTimeout(() => {
        navigate(`/read/${res.data.bookId}`)
      }, 500)
    } catch (error) {
      console.error('Upload failed:', error)
      alert(error.response?.data?.error || 'アップロードに失敗しました')
    } finally {
      setUploading(false)
      setUploadProgress('')
    }
  }

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleUpload(file)
  }, [])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
  }, [])

  const handleDelete = async (e, bookId) => {
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

  // Sort books based on selected option
  const sortedBooks = [...books].sort((a, b) => {
    switch (sortBy) {
      case 'title':
        return a.title.localeCompare(b.title, 'ja')
      case 'added':
        return new Date(b.created_at) - new Date(a.created_at)
      case 'lastRead':
      default:
        return new Date(b.updated_at) - new Date(a.updated_at)
    }
  })

  // Open book
  const openBook = (book) => {
    navigate(`/read/${book.id}`)
  }

  // Open edit modal
  const openEditModal = (e, book) => {
    e.stopPropagation()
    setEditingBook(book)
    setEditTitle(book.title)
    setEditLanguage(book.language || 'en')
  }

  // Save book edits
  const saveBookEdit = async () => {
    if (!editingBook) return
    
    try {
      await axios.patch(`/api/books/${editingBook.id}`, {
        title: editTitle,
        language: editLanguage
      })
      fetchBooks()
      setEditingBook(null)
    } catch (error) {
      console.error('Failed to update book:', error)
      alert('更新に失敗しました')
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
            onClick={() => document.getElementById('file-input').click()}
          >
            <input
              id="file-input"
              type="file"
              accept=".epub"
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
                <p>EPUBファイルをドロップ、またはクリックして選択</p>
                <p className="hint">pandocでHTMLに変換されます</p>
              </>
            )}
          </div>
        </section>

        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0, color: '#333' }}>ライブラリ</h2>
            <div className="sort-controls">
              <label style={{ marginRight: '8px', color: '#666', fontSize: '0.9rem' }}>並び替え:</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="sort-select"
              >
                <option value="lastRead">最終閲覧日時</option>
                <option value="title">タイトル順</option>
                <option value="added">追加日時</option>
              </select>
            </div>
          </div>
          
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
              {sortedBooks.map((book) => (
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
                        e.target.style.display = 'none'
                        e.target.parentElement.classList.add('no-cover')
                      }}
                    />
                    <div className="no-cover-icon">📖</div>
                  </div>
                  <div className="book-info">
                    <h3>{book.title}</h3>
                    <div className="meta">
                      {book.total_pages}ページ
                      {book.current_page && (
                        <> • {Math.round((book.current_page / book.total_pages) * 100)}% 読了</>
                      )}
                    </div>
                    <div className="meta" style={{ fontSize: '0.75rem', marginTop: '4px' }}>
                      🌐 {book.language === 'ja' ? '日本語' : book.language === 'en' ? '英語' : book.language || '英語'}
                    </div>
                    <div className="progress-bar">
                      <div
                        className="fill"
                        style={{
                          width: `${((book.current_page || 1) / book.total_pages) * 100}%`
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

      {/* Edit Book Modal */}
      {editingBook && (
        <div className="modal-overlay" onClick={() => setEditingBook(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>📚 書籍情報を編集</h3>
            
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
            
            <div className="buttons">
              <button className="secondary" onClick={() => setEditingBook(null)}>
                キャンセル
              </button>
              <button className="primary" onClick={saveBookEdit}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Home
