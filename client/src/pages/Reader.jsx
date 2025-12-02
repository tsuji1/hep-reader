import axios from 'axios'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

function Reader() {
  const { bookId } = useParams()
  const [book, setBook] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [bookmarks, setBookmarks] = useState([])
  const [toc, setToc] = useState([])
  const [sidebarTab, setSidebarTab] = useState('toc')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [showBookmarkModal, setShowBookmarkModal] = useState(false)
  const [bookmarkNote, setBookmarkNote] = useState('')
  const [showPageJumpModal, setShowPageJumpModal] = useState(false)
  const [jumpPageInput, setJumpPageInput] = useState('')
  const [viewMode, setViewMode] = useState('scroll') // 'scroll' or 'page'
  
  const contentRef = useRef(null)
  const pageRefs = useRef({})
  const isScrollingToPage = useRef(false)

  // Fetch book info and all pages
  useEffect(() => {
    const fetchBook = async () => {
      try {
        const res = await axios.get(`/api/books/${bookId}`)
        setBook(res.data)
        
        // Fetch all pages
        const pagesRes = await axios.get(`/api/books/${bookId}/all-pages`)
        setPages(pagesRes.data.pages)
        
        // Determine initial page from saved progress
        const progressRes = await axios.get(`/api/books/${bookId}/progress`)
        const initialPage = progressRes.data.currentPage || 1
        setCurrentPage(initialPage)
        
        // Fetch TOC
        const tocRes = await axios.get(`/api/books/${bookId}/toc`)
        setToc(tocRes.data.toc || [])
        
        // Fetch bookmarks
        fetchBookmarks()
        
        setLoading(false)
      } catch (error) {
        console.error('Failed to fetch book:', error)
        setLoading(false)
      }
    }
    
    fetchBook()
  }, [bookId])

  // Scroll to initial page after pages are loaded
  useEffect(() => {
    if (!loading && pages.length > 0 && currentPage > 1) {
      setTimeout(() => {
        scrollToPage(currentPage, false)
      }, 100)
    }
  }, [loading, pages.length])

  // Handle scroll to detect current page (only in scroll mode)
  useEffect(() => {
    if (viewMode !== 'scroll') return
    
    const handleScroll = () => {
      if (isScrollingToPage.current || !contentRef.current) return
      
      const container = contentRef.current
      const containerTop = container.getBoundingClientRect().top
      
      // Find which page is currently most visible
      let visiblePage = 1
      for (let i = 1; i <= pages.length; i++) {
        const pageEl = pageRefs.current[i]
        if (pageEl) {
          const rect = pageEl.getBoundingClientRect()
          const pageTop = rect.top - containerTop
          
          // If this page's top is above the middle of the viewport, it's the current page
          if (pageTop <= 100) {
            visiblePage = i
          }
        }
      }
      
      if (visiblePage !== currentPage) {
        setCurrentPage(visiblePage)
        
        // Save progress (debounced)
        axios.post(`/api/books/${bookId}/progress`, { currentPage: visiblePage })
      }
    }
    
    const container = contentRef.current
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true })
      return () => container.removeEventListener('scroll', handleScroll)
    }
  }, [bookId, currentPage, pages.length, viewMode])

  const fetchBookmarks = async () => {
    try {
      const res = await axios.get(`/api/books/${bookId}/bookmarks`)
      setBookmarks(res.data)
    } catch (error) {
      console.error('Failed to fetch bookmarks:', error)
    }
  }

  const scrollToPage = (page, smooth = true) => {
    const pageEl = pageRefs.current[page]
    if (pageEl && contentRef.current) {
      isScrollingToPage.current = true
      pageEl.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
      
      setTimeout(() => {
        isScrollingToPage.current = false
      }, smooth ? 500 : 100)
    }
  }

  const goToPage = (page) => {
    if (page >= 1 && page <= (book?.total || 1)) {
      setCurrentPage(page)
      if (viewMode === 'scroll') {
        scrollToPage(page)
      }
      axios.post(`/api/books/${bookId}/progress`, { currentPage: page })
    }
  }

  const addBookmark = async () => {
    try {
      await axios.post(`/api/books/${bookId}/bookmarks`, {
        pageNum: currentPage,
        note: bookmarkNote
      })
      fetchBookmarks()
      setShowBookmarkModal(false)
      setBookmarkNote('')
    } catch (error) {
      console.error('Failed to add bookmark:', error)
    }
  }

  const deleteBookmark = async (e, bookmarkId) => {
    e.stopPropagation()
    try {
      await axios.delete(`/api/bookmarks/${bookmarkId}`)
      fetchBookmarks()
    } catch (error) {
      console.error('Failed to delete bookmark:', error)
    }
  }

  const isCurrentPageBookmarked = bookmarks.some(b => b.page_num === currentPage)

  const handlePageJump = () => {
    const pageNum = parseInt(jumpPageInput)
    if (pageNum >= 1 && pageNum <= (book?.total || 1)) {
      goToPage(pageNum)
      setShowPageJumpModal(false)
      setJumpPageInput('')
    } else {
      alert(`1から${book?.total || 1}の間で入力してください`)
    }
  }

  // Fix image paths in content
  const fixContent = (content) => {
    return content
      .replace(/src="\/home\/[^"]*\/media\//g, `src="/api/books/${bookId}/media/`)
      .replace(/src="media\//g, `src="/api/books/${bookId}/media/`)
      .replace(/src="\.\/media\//g, `src="/api/books/${bookId}/media/`)
      .replace(/max-width:\s*800px/g, 'max-width: 100%')
  }

  if (!book) {
    return <div className="loading">読み込み中</div>
  }

  return (
    <div className="reader">
      {/* Sidebar */}
      <aside className={`reader-sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
        <div className="sidebar-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Link to="/" style={{ color: '#667eea', textDecoration: 'none', fontSize: '0.9rem' }}>
              ← ライブラリ
            </Link>
            <button
              onClick={() => setSidebarOpen(false)}
              className="close-sidebar-btn"
              title="サイドバーを閉じる"
            >
              ✕
            </button>
          </div>
          <h2 style={{ marginTop: '10px', fontSize: '1rem', lineHeight: '1.4' }}>{book.title}</h2>
        </div>
        
        <div className="sidebar-tabs">
          <button
            className={sidebarTab === 'toc' ? 'active' : ''}
            onClick={() => setSidebarTab('toc')}
          >
            目次 ({toc.length})
          </button>
          <button
            className={sidebarTab === 'bookmarks' ? 'active' : ''}
            onClick={() => setSidebarTab('bookmarks')}
          >
            しおり ({bookmarks.length})
          </button>
        </div>
        
        <div className="sidebar-content">
          {sidebarTab === 'toc' ? (
            toc.length === 0 ? (
              <p style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
                目次がありません
              </p>
            ) : (
              <div className="toc-list">
                {toc.map((item, index) => (
                  <div
                    key={index}
                    className={`toc-item level-${item.level} ${item.page === currentPage ? 'active' : ''}`}
                    onClick={() => goToPage(item.page)}
                  >
                    <span className="toc-title">{item.title}</span>
                    <span className="toc-page">p.{item.page}</span>
                  </div>
                ))}
              </div>
            )
          ) : (
            bookmarks.length === 0 ? (
              <p style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
                しおりがありません<br />
                <small>ページを開いて「しおり」ボタンを押してください</small>
              </p>
            ) : (
              bookmarks.map((bookmark) => (
                <div
                  key={bookmark.id}
                  className={`bookmark-item ${bookmark.page_num === currentPage ? 'active' : ''}`}
                  onClick={() => goToPage(bookmark.page_num)}
                >
                  <span className="page">p.{bookmark.page_num}</span>
                  <span className="note">{bookmark.note || '(メモなし)'}</span>
                  <button
                    className="delete"
                    onClick={(e) => deleteBookmark(e, bookmark.id)}
                    title="削除"
                  >
                    🗑
                  </button>
                </div>
              ))
            )
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="reader-main">
        <div className="reader-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {!sidebarOpen && (
              <button
                className="secondary"
                onClick={() => setSidebarOpen(true)}
                title="サイドバーを開く"
              >
                ☰ 目次
              </button>
            )}
            
            <button
              className={`bookmark-btn ${isCurrentPageBookmarked ? 'active' : ''}`}
              onClick={() => isCurrentPageBookmarked ? null : setShowBookmarkModal(true)}
              title={isCurrentPageBookmarked ? 'しおり済み' : 'しおりを追加'}
            >
              {isCurrentPageBookmarked ? '🔖' : '📑'} しおり
            </button>
            
            <div className="view-mode-toggle">
              <button
                className={viewMode === 'scroll' ? 'active' : ''}
                onClick={() => setViewMode('scroll')}
                title="スクロールモード"
              >
                📜
              </button>
              <button
                className={viewMode === 'page' ? 'active' : ''}
                onClick={() => setViewMode('page')}
                title="ページモード"
              >
                📄
              </button>
            </div>
          </div>
          
          <span 
            className="page-info clickable"
            onClick={() => {
              setJumpPageInput(currentPage.toString())
              setShowPageJumpModal(true)
            }}
            title="クリックしてページを指定"
          >
            {currentPage} / {book.total} ページ
          </span>
          
          <div className="nav-buttons">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              ← 前へ
            </button>
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= book.total}
            >
              次へ →
            </button>
          </div>
        </div>

        <div className="reader-content" ref={contentRef}>
          {loading ? (
            <div className="loading">読み込み中</div>
          ) : viewMode === 'scroll' ? (
            <div className="content-continuous">
              {pages.map((page) => (
                <div
                  key={page.pageNum}
                  ref={(el) => pageRefs.current[page.pageNum] = el}
                  className={`page-section ${page.pageNum === currentPage ? 'current' : ''}`}
                  data-page={page.pageNum}
                >
                  <div
                    className="content-html"
                    lang={book.language || 'en'}
                    dangerouslySetInnerHTML={{ __html: fixContent(page.content) }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="content-single-page">
              {pages[currentPage - 1] && (
                <div
                  className="content-html"
                  lang={book.language || 'en'}
                  dangerouslySetInnerHTML={{ __html: fixContent(pages[currentPage - 1].content) }}
                />
              )}
            </div>
          )}
        </div>
      </main>

      {/* Bookmark Modal */}
      {showBookmarkModal && (
        <div className="modal-overlay" onClick={() => setShowBookmarkModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>🔖 しおりを追加</h3>
            <p style={{ marginBottom: '15px', color: '#666' }}>
              ページ {currentPage} にしおりを追加します
            </p>
            <textarea
              placeholder="メモ (任意)"
              value={bookmarkNote}
              onChange={(e) => setBookmarkNote(e.target.value)}
              rows={3}
            />
            <div className="buttons">
              <button
                className="secondary"
                onClick={() => setShowBookmarkModal(false)}
              >
                キャンセル
              </button>
              <button className="primary" onClick={addBookmark}>
                追加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page Jump Modal */}
      {showPageJumpModal && (
        <div className="modal-overlay" onClick={() => setShowPageJumpModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>📄 ページを指定して移動</h3>
            <p style={{ marginBottom: '15px', color: '#666' }}>
              1 〜 {book.total} の間でページ番号を入力
            </p>
            <input
              type="number"
              min="1"
              max={book.total}
              value={jumpPageInput}
              onChange={(e) => setJumpPageInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePageJump()}
              placeholder="ページ番号"
              autoFocus
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '1.2rem',
                textAlign: 'center',
                border: '2px solid #e2e8f0',
                borderRadius: '8px',
                marginBottom: '15px'
              }}
            />
            <div className="buttons">
              <button
                className="secondary"
                onClick={() => setShowPageJumpModal(false)}
              >
                キャンセル
              </button>
              <button className="primary" onClick={handlePageJump}>
                移動
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Reader
