import axios from 'axios'
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import PdfViewer from '../components/PdfViewer'
import { openImageInNewWindow, openClipInNewWindow, fixEpubImagePaths } from '../utils/window'
import type { Book, Bookmark, Clip, ClipPosition, TocItem, PageContent } from '../types'

type SidebarTab = 'toc' | 'bookmarks' | 'clips'
type ViewMode = 'scroll' | 'page'

function Reader(): JSX.Element {
  const { bookId } = useParams<{ bookId: string }>()
  const [book, setBook] = useState<Book | null>(null)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [totalPages, setTotalPages] = useState<number>(1)
  const [pages, setPages] = useState<PageContent[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [clips, setClips] = useState<Clip[]>([])
  const [toc, setToc] = useState<TocItem[]>([])
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('toc')
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true)
  const [showBookmarkModal, setShowBookmarkModal] = useState<boolean>(false)
  const [bookmarkNote, setBookmarkNote] = useState<string>('')
  const [showPageJumpModal, setShowPageJumpModal] = useState<boolean>(false)
  const [jumpPageInput, setJumpPageInput] = useState<string>('')
  const [viewMode, setViewMode] = useState<ViewMode>('scroll')
  const [isPdf, setIsPdf] = useState<boolean>(false)
  const [pdfTotalPages, setPdfTotalPages] = useState<number>(0)
  
  // クリップ機能
  const [clipMode, setClipMode] = useState<boolean>(false)
  const [showClipModal, setShowClipModal] = useState<boolean>(false)
  const [clipImageData, setClipImageData] = useState<string | null>(null)
  const [clipPageNum, setClipPageNum] = useState<number>(1)
  const [clipNote, setClipNote] = useState<string>('')
  const [clipPosition, setClipPosition] = useState<ClipPosition | null>(null)
  
  const contentRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const isScrollingToPage = useRef<boolean>(false)

  // Fetch book info and all pages
  useEffect(() => {
    const fetchBook = async (): Promise<void> => {
      if (!bookId) return
      
      try {
        const res = await axios.get<Book>(`/api/books/${bookId}`)
        setBook(res.data)
        
        // PDFの場合は別処理 (category または original_filename で判定)
        const isPdfBook = res.data.category === 'pdf' || 
                      (res.data.original_filename && res.data.original_filename.toLowerCase().endsWith('.pdf'))
        
        if (isPdfBook) {
          setIsPdf(true)
          // PDFの読み込み進捗を取得
          const progressRes = await axios.get<{ currentPage: number }>(`/api/books/${bookId}/progress`)
          const initialPage = progressRes.data.currentPage || 1
          setCurrentPage(initialPage)
          fetchBookmarks()
          fetchClips()
          setLoading(false)
          return
        }
        
        // Fetch all pages (EPUB)
        const pagesRes = await axios.get<{ pages: PageContent[]; total: number }>(`/api/books/${bookId}/all-pages`)
        setPages(pagesRes.data.pages)
        setTotalPages(pagesRes.data.total)
        
        // Determine initial page from saved progress
        const progressRes = await axios.get<{ currentPage: number }>(`/api/books/${bookId}/progress`)
        const initialPage = progressRes.data.currentPage || 1
        setCurrentPage(initialPage)
        
        // Fetch TOC
        const tocRes = await axios.get<{ toc: TocItem[] }>(`/api/books/${bookId}/toc`)
        setToc(tocRes.data.toc || [])
        
        // Fetch bookmarks and clips
        fetchBookmarks()
        fetchClips()
        
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
    if (!loading && pages.length > 0 && currentPage > 1 && !isPdf) {
      setTimeout(() => {
        scrollToPage(currentPage, false)
      }, 100)
    }
  }, [loading, pages.length, isPdf])

  // Handle scroll to detect current page (only in scroll mode for EPUB)
  useEffect(() => {
    if (viewMode !== 'scroll' || isPdf) return
    
    const handleScroll = (): void => {
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
  }, [bookId, currentPage, pages.length, viewMode, isPdf])

  // EPUB画像クリックハンドラを設定（別ウィンドウで開く）
  useEffect(() => {
    if (isPdf || !contentRef.current) return

    const handleImageClick = (e: Event): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'IMG') {
        e.preventDefault()
        const imgElement = target as HTMLImageElement
        openImageInNewWindow({
          src: imgElement.src,
          alt: imgElement.alt || '画像'
        })
      }
    }

    const container = contentRef.current
    container.addEventListener('click', handleImageClick)
    return () => container.removeEventListener('click', handleImageClick)
  }, [isPdf, loading])

  const fetchBookmarks = async (): Promise<void> => {
    try {
      const res = await axios.get<Bookmark[]>(`/api/books/${bookId}/bookmarks`)
      setBookmarks(res.data)
    } catch (error) {
      console.error('Failed to fetch bookmarks:', error)
    }
  }

  const fetchClips = async (): Promise<void> => {
    try {
      const res = await axios.get<Clip[]>(`/api/books/${bookId}/clips`)
      setClips(res.data)
    } catch (error) {
      console.error('Failed to fetch clips:', error)
    }
  }

  const scrollToPage = (page: number, smooth: boolean = true): void => {
    const pageEl = pageRefs.current[page]
    if (pageEl && contentRef.current) {
      isScrollingToPage.current = true
      pageEl.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
      
      setTimeout(() => {
        isScrollingToPage.current = false
      }, smooth ? 500 : 100)
    }
  }

  const goToPage = (page: number): void => {
    const maxPages = isPdf ? pdfTotalPages : totalPages
    if (page >= 1 && page <= maxPages) {
      setCurrentPage(page)
      if (!isPdf && viewMode === 'scroll') {
        scrollToPage(page)
      }
      axios.post(`/api/books/${bookId}/progress`, { currentPage: page })
    }
  }

  // PDFのページ変更ハンドラ
  const handlePdfPageChange = (page: number): void => {
    setCurrentPage(page)
    axios.post(`/api/books/${bookId}/progress`, { currentPage: page })
  }

  // PDFの総ページ数を受け取る
  const handlePdfTotalPages = (total: number): void => {
    setPdfTotalPages(total)
    setTotalPages(total)
  }

  const addBookmark = async (): Promise<void> => {
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

  const deleteBookmark = async (e: MouseEvent, bookmarkId: string): Promise<void> => {
    e.stopPropagation()
    try {
      await axios.delete(`/api/bookmarks/${bookmarkId}`)
      fetchBookmarks()
    } catch (error) {
      console.error('Failed to delete bookmark:', error)
    }
  }

  // クリップ保存
  const saveClip = async (): Promise<void> => {
    try {
      await axios.post(`/api/books/${bookId}/clips`, {
        pageNum: clipPageNum,
        imageData: clipImageData,
        note: clipNote,
        position: clipPosition
      })
      fetchClips()
      setShowClipModal(false)
      setClipImageData(null)
      setClipNote('')
      setClipPosition(null)
      setClipMode(false)
    } catch (error) {
      console.error('Failed to save clip:', error)
    }
  }

  // クリップ削除
  const deleteClip = async (e: MouseEvent, clipId: string): Promise<void> => {
    e.stopPropagation()
    try {
      await axios.delete(`/api/clips/${clipId}`)
      fetchClips()
    } catch (error) {
      console.error('Failed to delete clip:', error)
    }
  }

  // PDFからクリップを受け取るコールバック
  const handleClipCapture = useCallback((pageNum: number, imageData: string, position: ClipPosition): void => {
    setClipPageNum(pageNum)
    setClipImageData(imageData)
    setClipPosition(position)
    setShowClipModal(true)
  }, [])

  const isCurrentPageBookmarked = bookmarks.some(b => b.page_num === currentPage)

  const handlePageJump = (): void => {
    const pageNum = parseInt(jumpPageInput)
    const maxPages = isPdf ? pdfTotalPages : totalPages
    if (pageNum >= 1 && pageNum <= maxPages) {
      goToPage(pageNum)
      setShowPageJumpModal(false)
      setJumpPageInput('')
    } else {
      alert(`1から${maxPages}の間で入力してください`)
    }
  }

  // Fix image paths in content
  const fixContent = (content: string): string => {
    return fixEpubImagePaths(content, bookId || '')
  }

  if (!book) {
    return <div className="loading">読み込み中</div>
  }

  const displayTotalPages = isPdf ? pdfTotalPages : totalPages

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
          {isPdf && (
            <a 
              href={`/api/books/${bookId}/pdf`} 
              download={`${book.title}.pdf`}
              style={{
                display: 'inline-block',
                marginTop: '10px',
                padding: '6px 12px',
                background: '#667eea',
                color: 'white',
                borderRadius: '4px',
                textDecoration: 'none',
                fontSize: '0.8rem'
              }}
            >
              ⬇ ダウンロード
            </a>
          )}
        </div>
        
        <div className="sidebar-tabs">
          {!isPdf && (
            <button
              className={sidebarTab === 'toc' ? 'active' : ''}
              onClick={() => setSidebarTab('toc')}
            >
              目次
            </button>
          )}
          <button
            className={sidebarTab === 'bookmarks' ? 'active' : ''}
            onClick={() => setSidebarTab('bookmarks')}
          >
            しおり ({bookmarks.length})
          </button>
          <button
            className={sidebarTab === 'clips' ? 'active' : ''}
            onClick={() => setSidebarTab('clips')}
          >
            📷 ({clips.length})
          </button>
        </div>
        
        <div className="sidebar-content">
          {sidebarTab === 'toc' && !isPdf ? (
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
          ) : sidebarTab === 'bookmarks' ? (
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
          ) : (
            // クリップタブ
            clips.length === 0 ? (
              <p style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
                クリップがありません<br />
                <small>{isPdf ? '📷ボタンで範囲選択してキャプチャ' : '画像をクリックして保存'}</small>
              </p>
            ) : (
              clips.map((clip) => (
                <div
                  key={clip.id}
                  className="clip-item"
                  onClick={() => openClipInNewWindow(clip)}
                >
                  <div className="clip-thumb">
                    <img src={clip.image_data} alt="" />
                  </div>
                  <div className="clip-info">
                    <span className="page">p.{clip.page_num}</span>
                    <span className="note">{clip.note || '(メモなし)'}</span>
                  </div>
                  <button
                    className="delete"
                    onClick={(e) => deleteClip(e, clip.id)}
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

            {isPdf && (
              <button
                className={`clip-btn ${clipMode ? 'active' : ''}`}
                onClick={() => setClipMode(!clipMode)}
                title={clipMode ? 'クリップモード終了' : '範囲選択してクリップ'}
              >
                📷 クリップ
              </button>
            )}
            
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
            {currentPage} / {displayTotalPages || '?'} ページ
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
              disabled={currentPage >= displayTotalPages}
            >
              次へ →
            </button>
          </div>
        </div>

        <div className="reader-content" ref={contentRef}>
          {loading ? (
            <div className="loading">読み込み中</div>
          ) : isPdf ? (
            <PdfViewer
              pdfUrl={`/api/books/${bookId}/pdf`}
              currentPage={currentPage}
              onPageChange={handlePdfPageChange}
              onTotalPagesChange={handlePdfTotalPages}
              viewMode={viewMode}
              clipMode={clipMode}
              onClipCapture={handleClipCapture}
              clips={clips}
              onClipClick={openClipInNewWindow}
            />
          ) : viewMode === 'scroll' ? (
            <div className="content-continuous">
              {pages.map((page) => (
                <div
                  key={page.pageNum}
                  ref={(el) => { pageRefs.current[page.pageNum] = el }}
                  className={`page-section ${page.pageNum === currentPage ? 'current' : ''}`}
                  data-page={page.pageNum}
                >
                  <div
                    className="content-html clickable-images"
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
                  className="content-html clickable-images"
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

      {/* Clip Modal */}
      {showClipModal && (
        <div className="modal-overlay" onClick={() => setShowClipModal(false)}>
          <div className="modal clip-modal" onClick={(e) => e.stopPropagation()}>
            <h3>📷 クリップを保存</h3>
            <p style={{ marginBottom: '15px', color: '#666' }}>
              ページ {clipPageNum} のクリップを保存します
            </p>
            {clipImageData && (
              <div className="clip-preview">
                <img src={clipImageData} alt="クリップ" />
              </div>
            )}
            <textarea
              placeholder="メモ (任意)"
              value={clipNote}
              onChange={(e) => setClipNote(e.target.value)}
              rows={2}
            />
            <div className="buttons">
              <button
                className="secondary"
                onClick={() => {
                  setShowClipModal(false)
                  setClipImageData(null)
                  setClipNote('')
                }}
              >
                キャンセル
              </button>
              <button className="primary" onClick={saveClip}>
                保存
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
              1 〜 {displayTotalPages} の間でページ番号を入力
            </p>
            <input
              type="number"
              min="1"
              max={displayTotalPages}
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
