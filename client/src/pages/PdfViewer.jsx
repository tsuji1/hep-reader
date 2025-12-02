import axios from 'axios'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import PdfViewerComponent from '../components/PdfViewer'

function PdfViewer() {
  const { bookId } = useParams()
  const [book, setBook] = useState(null)
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [viewMode, setViewMode] = useState('page') // 'page' or 'scroll'
  const [bookmarks, setBookmarks] = useState([])
  const [showBookmarkModal, setShowBookmarkModal] = useState(false)
  const [bookmarkNote, setBookmarkNote] = useState('')

  useEffect(() => {
    const fetchBook = async () => {
      try {
        const res = await axios.get(`/api/books/${bookId}`)
        setBook(res.data)
        
        // 読書進捗を取得
        const progressRes = await axios.get(`/api/books/${bookId}/progress`)
        if (progressRes.data && progressRes.data.current_page) {
          setCurrentPage(progressRes.data.current_page)
        }
        
        // ブックマークを取得
        const bookmarksRes = await axios.get(`/api/books/${bookId}/bookmarks`)
        setBookmarks(bookmarksRes.data || [])
      } catch (error) {
        console.error('Failed to fetch book:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchBook()
  }, [bookId])

  // 読書進捗を保存
  useEffect(() => {
    if (book && currentPage > 0) {
      axios.put(`/api/books/${bookId}/progress`, { currentPage })
        .catch(err => console.error('Failed to save progress:', err))
    }
  }, [bookId, book, currentPage])

  const handlePageChange = useCallback((page) => {
    setCurrentPage(page)
  }, [])

  const handleTotalPagesChange = useCallback((total) => {
    setTotalPages(total)
  }, [])

  const goToPrevPage = () => {
    if (currentPage > 1) setCurrentPage(prev => prev - 1)
  }

  const goToNextPage = () => {
    if (currentPage < totalPages) setCurrentPage(prev => prev + 1)
  }

  const addBookmark = async () => {
    try {
      const res = await axios.post(`/api/books/${bookId}/bookmarks`, {
        pageNum: currentPage,
        note: bookmarkNote
      })
      setBookmarks([...bookmarks, res.data])
      setShowBookmarkModal(false)
      setBookmarkNote('')
    } catch (error) {
      console.error('Failed to add bookmark:', error)
    }
  }

  const deleteBookmark = async (id) => {
    try {
      await axios.delete(`/api/books/${bookId}/bookmarks/${id}`)
      setBookmarks(bookmarks.filter(b => b.id !== id))
    } catch (error) {
      console.error('Failed to delete bookmark:', error)
    }
  }

  if (loading) {
    return <div className="loading">読み込み中...</div>
  }

  if (!book) {
    return (
      <div className="error">
        <p>書籍が見つかりません</p>
        <Link to="/">ライブラリに戻る</Link>
      </div>
    )
  }

  return (
    <div className="reader-container">
      {/* サイドバー */}
      <aside className="reader-sidebar">
        <Link to="/" className="back-link">← ライブラリ</Link>
        <h2>{book.title}</h2>
        
        <div className="sidebar-section">
          <h3>表示モード</h3>
          <div className="view-mode-buttons">
            <button 
              className={viewMode === 'page' ? 'active' : ''} 
              onClick={() => setViewMode('page')}
            >
              ページ
            </button>
            <button 
              className={viewMode === 'scroll' ? 'active' : ''} 
              onClick={() => setViewMode('scroll')}
            >
              スクロール
            </button>
          </div>
        </div>

        <div className="sidebar-section">
          <h3>しおり</h3>
          <button 
            className="add-bookmark-btn"
            onClick={() => setShowBookmarkModal(true)}
          >
            + 現在のページにしおりを追加
          </button>
          <ul className="bookmark-list">
            {bookmarks.map(bm => (
              <li key={bm.id} className="bookmark-item">
                <button 
                  className="bookmark-link"
                  onClick={() => setCurrentPage(bm.page_num)}
                >
                  p.{bm.page_num} {bm.note && `- ${bm.note}`}
                </button>
                <button 
                  className="bookmark-delete"
                  onClick={() => deleteBookmark(bm.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="sidebar-section">
          <h3>ページ移動</h3>
          <div className="page-jump">
            <input
              type="number"
              min="1"
              max={totalPages}
              value={currentPage}
              onChange={(e) => {
                const page = parseInt(e.target.value, 10)
                if (page >= 1 && page <= totalPages) {
                  setCurrentPage(page)
                }
              }}
            />
            <span>/ {totalPages}</span>
          </div>
        </div>
      </aside>

      {/* メインコンテンツ */}
      <main className="reader-main">
        <PdfViewerComponent
          pdfUrl={`/api/books/${bookId}/pdf`}
          currentPage={currentPage}
          onPageChange={handlePageChange}
          onTotalPagesChange={handleTotalPagesChange}
          viewMode={viewMode}
        />

        {/* ページ送りボタン（ページモード時） */}
        {viewMode === 'page' && (
          <div className="page-navigation">
            <button 
              onClick={goToPrevPage} 
              disabled={currentPage <= 1}
            >
              ← 前のページ
            </button>
            <span>{currentPage} / {totalPages}</span>
            <button 
              onClick={goToNextPage} 
              disabled={currentPage >= totalPages}
            >
              次のページ →
            </button>
          </div>
        )}
      </main>

      {/* ブックマーク追加モーダル */}
      {showBookmarkModal && (
        <div className="modal-overlay" onClick={() => setShowBookmarkModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>しおりを追加</h3>
            <p>ページ: {currentPage}</p>
            <input
              type="text"
              placeholder="メモ（任意）"
              value={bookmarkNote}
              onChange={(e) => setBookmarkNote(e.target.value)}
            />
            <div className="modal-buttons">
              <button onClick={() => setShowBookmarkModal(false)}>キャンセル</button>
              <button onClick={addBookmark}>追加</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PdfViewer
