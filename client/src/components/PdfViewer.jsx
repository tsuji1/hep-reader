import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// PDF.js worker設定
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

function PdfViewer({ pdfUrl, currentPage, onPageChange, onTotalPagesChange, viewMode }) {
  const [pdf, setPdf] = useState(null)
  const [totalPages, setTotalPages] = useState(0)
  const [renderedPages, setRenderedPages] = useState({})
  const [loading, setLoading] = useState(true)
  const [scale, setScale] = useState(1.5)
  const containerRef = useRef(null)
  const pageRefs = useRef({})
  const isScrollingToPage = useRef(false)

  // PDFを読み込み
  useEffect(() => {
    const loadPdf = async () => {
      try {
        setLoading(true)
        const loadingTask = pdfjsLib.getDocument(pdfUrl)
        const pdfDoc = await loadingTask.promise
        setPdf(pdfDoc)
        setTotalPages(pdfDoc.numPages)
        if (onTotalPagesChange) {
          onTotalPagesChange(pdfDoc.numPages)
        }
        setLoading(false)
      } catch (error) {
        console.error('PDF load error:', error)
        setLoading(false)
      }
    }
    
    loadPdf()
  }, [pdfUrl, onTotalPagesChange])

  // ページをレンダリング
  const renderPage = async (pageNum) => {
    if (!pdf || renderedPages[pageNum]) return
    
    try {
      const page = await pdf.getPage(pageNum)
      const viewport = page.getViewport({ scale })
      
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      canvas.height = viewport.height
      canvas.width = viewport.width
      
      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise
      
      setRenderedPages(prev => ({
        ...prev,
        [pageNum]: canvas.toDataURL()
      }))
    } catch (error) {
      console.error(`Error rendering page ${pageNum}:`, error)
    }
  }

  // 全ページをレンダリング（スクロールモード用）
  useEffect(() => {
    if (!pdf || viewMode !== 'scroll') return
    
    const renderAllPages = async () => {
      for (let i = 1; i <= totalPages; i++) {
        await renderPage(i)
      }
    }
    
    renderAllPages()
  }, [pdf, totalPages, viewMode, scale])

  // 現在のページをレンダリング（ページモード用）
  useEffect(() => {
    if (!pdf || viewMode !== 'page') return
    renderPage(currentPage)
    // 前後のページもプリロード
    if (currentPage > 1) renderPage(currentPage - 1)
    if (currentPage < totalPages) renderPage(currentPage + 1)
  }, [pdf, currentPage, viewMode, scale])

  // スクロール時のページ検出
  useEffect(() => {
    if (viewMode !== 'scroll') return
    
    const handleScroll = () => {
      if (isScrollingToPage.current || !containerRef.current) return
      
      const container = containerRef.current
      const containerTop = container.getBoundingClientRect().top
      
      let visiblePage = 1
      for (let i = 1; i <= totalPages; i++) {
        const pageEl = pageRefs.current[i]
        if (pageEl) {
          const rect = pageEl.getBoundingClientRect()
          const pageTop = rect.top - containerTop
          
          if (pageTop <= 100) {
            visiblePage = i
          }
        }
      }
      
      if (visiblePage !== currentPage) {
        onPageChange(visiblePage)
      }
    }
    
    const container = containerRef.current
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true })
      return () => container.removeEventListener('scroll', handleScroll)
    }
  }, [currentPage, totalPages, viewMode, onPageChange])

  // ページへスクロール
  const scrollToPage = (page) => {
    const pageEl = pageRefs.current[page]
    if (pageEl && containerRef.current) {
      isScrollingToPage.current = true
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setTimeout(() => {
        isScrollingToPage.current = false
      }, 500)
    }
  }

  // currentPageが変わったらスクロール
  useEffect(() => {
    if (viewMode === 'scroll' && pageRefs.current[currentPage]) {
      scrollToPage(currentPage)
    }
  }, [currentPage, viewMode])

  if (loading) {
    return <div className="loading">PDF読み込み中...</div>
  }

  return (
    <div className="pdf-viewer-container" ref={containerRef}>
      <div className="pdf-controls">
        <button onClick={() => setScale(s => Math.max(0.5, s - 0.25))}>−</button>
        <span>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale(s => Math.min(3, s + 0.25))}>+</button>
      </div>
      
      {viewMode === 'scroll' ? (
        <div className="pdf-pages-scroll">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
            <div
              key={pageNum}
              ref={el => pageRefs.current[pageNum] = el}
              className={`pdf-page ${pageNum === currentPage ? 'current' : ''}`}
              data-page={pageNum}
            >
              {renderedPages[pageNum] ? (
                <img src={renderedPages[pageNum]} alt={`Page ${pageNum}`} />
              ) : (
                <div className="pdf-page-loading">
                  ページ {pageNum} を読み込み中...
                </div>
              )}
              <div className="pdf-page-number">p.{pageNum}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="pdf-page-single">
          {renderedPages[currentPage] ? (
            <img src={renderedPages[currentPage]} alt={`Page ${currentPage}`} />
          ) : (
            <div className="pdf-page-loading">
              ページ {currentPage} を読み込み中...
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default PdfViewer
