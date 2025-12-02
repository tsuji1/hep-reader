import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// PDF.js worker設定
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

// 日本語フォント用CMap設定
const CMAP_URL = 'https://unpkg.com/pdfjs-dist@4.4.168/cmaps/'
const CMAP_PACKED = true

// 個別ページコンポーネント
function PdfPage({ pdf, pageNum, scale, isVisible, clipMode, onClipCapture }) {
  const canvasRef = useRef(null)
  const textLayerRef = useRef(null)
  const [rendered, setRendered] = useState(false)
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 })
  const renderTaskRef = useRef(null)
  const currentScaleRef = useRef(scale)
  
  // クリップ選択状態
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionStart, setSelectionStart] = useState(null)
  const [selectionEnd, setSelectionEnd] = useState(null)
  
  // クリップ選択ハンドラー
  const handleMouseDown = (e) => {
    if (!clipMode) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setIsSelecting(true)
    setSelectionStart({ x, y })
    setSelectionEnd({ x, y })
  }
  
  const handleMouseMove = (e) => {
    if (!isSelecting || !clipMode) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height))
    setSelectionEnd({ x, y })
  }
  
  const handleMouseUp = () => {
    if (!isSelecting || !clipMode || !selectionStart || !selectionEnd) {
      setIsSelecting(false)
      return
    }
    
    // 選択範囲を計算
    const x = Math.min(selectionStart.x, selectionEnd.x)
    const y = Math.min(selectionStart.y, selectionEnd.y)
    const width = Math.abs(selectionEnd.x - selectionStart.x)
    const height = Math.abs(selectionEnd.y - selectionStart.y)
    
    // 最小サイズチェック
    if (width > 10 && height > 10 && canvasRef.current) {
      try {
        // キャンバスから選択範囲を切り出し
        const canvas = canvasRef.current
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = width
        tempCanvas.height = height
        const ctx = tempCanvas.getContext('2d')
        ctx.drawImage(canvas, x, y, width, height, 0, 0, width, height)
        const imageData = tempCanvas.toDataURL('image/png')
        
        if (onClipCapture) {
          onClipCapture(pageNum, imageData)
        }
      } catch (err) {
        console.error('クリップキャプチャエラー:', err)
      }
    }
    
    setIsSelecting(false)
    setSelectionStart(null)
    setSelectionEnd(null)
  }
  
  // 選択範囲の矩形を計算
  const getSelectionRect = () => {
    if (!selectionStart || !selectionEnd) return null
    return {
      left: Math.min(selectionStart.x, selectionEnd.x),
      top: Math.min(selectionStart.y, selectionEnd.y),
      width: Math.abs(selectionEnd.x - selectionStart.x),
      height: Math.abs(selectionEnd.y - selectionStart.y)
    }
  }

  useEffect(() => {
    // スケールが変わった場合は再レンダリングを許可
    if (currentScaleRef.current !== scale) {
      currentScaleRef.current = scale
      setRendered(false)
    }
  }, [scale])

  useEffect(() => {
    if (!pdf || !isVisible || rendered) return

    const renderPage = async () => {
      try {
        const page = await pdf.getPage(pageNum)
        const viewport = page.getViewport({ scale })
        
        setPageSize({ width: viewport.width, height: viewport.height })

        const canvas = canvasRef.current
        if (!canvas) return

        const context = canvas.getContext('2d')
        canvas.height = viewport.height
        canvas.width = viewport.width

        // 前のレンダリングタスクをキャンセル
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel()
          } catch (e) { /* ignore */ }
        }

        renderTaskRef.current = page.render({
          canvasContext: context,
          viewport: viewport
        })

        await renderTaskRef.current.promise

        // テキストレイヤーを追加（テキスト選択可能に）
        try {
          const textContent = await page.getTextContent()
          const textLayerDiv = textLayerRef.current
          if (textLayerDiv) {
            textLayerDiv.innerHTML = ''
            textLayerDiv.style.width = `${viewport.width}px`
            textLayerDiv.style.height = `${viewport.height}px`

            // 手動でテキストレイヤーを構築
            textContent.items.forEach(item => {
              const tx = pdfjsLib.Util.transform(
                viewport.transform,
                item.transform
              )
              const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1])
              const span = document.createElement('span')
              span.textContent = item.str
              span.style.position = 'absolute'
              span.style.left = `${tx[4]}px`
              span.style.top = `${tx[5] - fontSize}px`
              span.style.fontSize = `${fontSize}px`
              span.style.fontFamily = 'sans-serif'
              textLayerDiv.appendChild(span)
            })
          }
        } catch (e) {
          // テキストレイヤーの追加に失敗しても続行
          console.warn('Text layer failed:', e)
        }

        setRendered(true)
      } catch (error) {
        if (error.name !== 'RenderingCancelledException') {
          console.error(`Error rendering page ${pageNum}:`, error)
        }
      }
    }

    renderPage()

    return () => {
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel()
        } catch (e) { /* ignore */ }
      }
    }
  }, [pdf, pageNum, scale, isVisible, rendered])

  const selectionRect = getSelectionRect()

  return (
    <div 
      className={`pdf-page-wrapper ${clipMode ? 'clip-mode' : ''}`}
      style={{ 
        width: pageSize.width || 'auto',
        height: pageSize.height || 600,
        position: 'relative',
        cursor: clipMode ? 'crosshair' : 'auto'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <canvas ref={canvasRef} className="pdf-canvas" />
      <div ref={textLayerRef} className="pdf-text-layer" style={{ pointerEvents: clipMode ? 'none' : 'auto' }} />
      {!rendered && (
        <div className="pdf-page-loading-overlay">
          <span>読み込み中...</span>
        </div>
      )}
      {/* クリップ選択オーバーレイ */}
      {isSelecting && selectionRect && (
        <div 
          className="clip-selection-overlay"
          style={{
            position: 'absolute',
            left: selectionRect.left,
            top: selectionRect.top,
            width: selectionRect.width,
            height: selectionRect.height,
            border: '2px dashed #007bff',
            backgroundColor: 'rgba(0, 123, 255, 0.2)',
            pointerEvents: 'none'
          }}
        />
      )}
    </div>
  )
}

function PdfViewer({ pdfUrl, currentPage, onPageChange, onTotalPagesChange, viewMode, clipMode, onClipCapture }) {
  const [pdf, setPdf] = useState(null)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [scale, setScale] = useState(1.5)
  const [visiblePages, setVisiblePages] = useState({})
  const containerRef = useRef(null)
  const pageRefs = useRef({})
  const isScrollingToPage = useRef(false)

  // PDFを読み込み
  useEffect(() => {
    let isMounted = true

    const loadPdf = async () => {
      try {
        setLoading(true)
        const loadingTask = pdfjsLib.getDocument({
          url: pdfUrl,
          cMapUrl: CMAP_URL,
          cMapPacked: CMAP_PACKED,
        })
        const pdfDoc = await loadingTask.promise
        
        if (!isMounted) return
        
        setPdf(pdfDoc)
        setTotalPages(pdfDoc.numPages)
        if (onTotalPagesChange) {
          onTotalPagesChange(pdfDoc.numPages)
        }
        
        // 初期表示ページを設定
        const initialVisible = {}
        for (let i = Math.max(1, currentPage - 2); i <= Math.min(pdfDoc.numPages, currentPage + 2); i++) {
          initialVisible[i] = true
        }
        setVisiblePages(initialVisible)
        
        setLoading(false)
      } catch (error) {
        console.error('PDF load error:', error)
        if (isMounted) setLoading(false)
      }
    }

    loadPdf()

    return () => {
      isMounted = false
    }
  }, [pdfUrl])

  // ページモード時の表示ページ管理
  useEffect(() => {
    if (viewMode === 'page' && pdf) {
      setVisiblePages({
        [currentPage]: true,
        [currentPage - 1]: currentPage > 1,
        [currentPage + 1]: currentPage < totalPages
      })
    }
  }, [currentPage, viewMode, pdf, totalPages])

  // スクロールモード時のIntersection Observer
  useEffect(() => {
    if (viewMode !== 'scroll' || !pdf) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const pageNum = parseInt(entry.target.dataset.page, 10)
          if (entry.isIntersecting) {
            setVisiblePages(prev => ({ ...prev, [pageNum]: true }))
          }
        })
      },
      {
        root: containerRef.current,
        rootMargin: '200px 0px',
        threshold: 0
      }
    )

    // ページ要素を監視
    Object.values(pageRefs.current).forEach(el => {
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [viewMode, pdf, totalPages])

  // スクロール時のページ検出
  useEffect(() => {
    if (viewMode !== 'scroll') return

    const handleScroll = () => {
      if (isScrollingToPage.current || !containerRef.current) return

      const container = containerRef.current
      const containerRect = container.getBoundingClientRect()
      const containerCenter = containerRect.top + containerRect.height / 3

      let closestPage = 1
      let closestDistance = Infinity

      for (let i = 1; i <= totalPages; i++) {
        const pageEl = pageRefs.current[i]
        if (pageEl) {
          const rect = pageEl.getBoundingClientRect()
          const distance = Math.abs(rect.top - containerCenter)
          if (distance < closestDistance) {
            closestDistance = distance
            closestPage = i
          }
        }
      }

      if (closestPage !== currentPage) {
        onPageChange(closestPage)
      }
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true })
      return () => container.removeEventListener('scroll', handleScroll)
    }
  }, [currentPage, totalPages, viewMode, onPageChange])

  // ページへスクロール
  const scrollToPage = useCallback((page) => {
    const pageEl = pageRefs.current[page]
    if (pageEl && containerRef.current) {
      isScrollingToPage.current = true
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setTimeout(() => {
        isScrollingToPage.current = false
      }, 500)
    }
  }, [])

  // currentPageが変わったらスクロール（スクロールモード時）
  useEffect(() => {
    if (viewMode === 'scroll' && pageRefs.current[currentPage]) {
      scrollToPage(currentPage)
    }
  }, [currentPage, viewMode, scrollToPage])

  const handleZoomIn = () => setScale(s => Math.min(3, s + 0.25))
  const handleZoomOut = () => setScale(s => Math.max(0.5, s - 0.25))

  if (loading) {
    return <div className="loading">PDF読み込み中...</div>
  }

  return (
    <div className="pdf-viewer-container" ref={containerRef}>
      {/* ズームコントロール */}
      <div className="pdf-controls">
        <button onClick={handleZoomOut} title="縮小">−</button>
        <span>{Math.round(scale * 100)}%</span>
        <button onClick={handleZoomIn} title="拡大">+</button>
        {clipMode && (
          <span className="clip-mode-indicator">📷 クリップモード: ドラッグで範囲選択</span>
        )}
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
              <div className="pdf-page-number">
                <span>ページ {pageNum} / {totalPages}</span>
              </div>
              <div className="pdf-page-content">
                <PdfPage
                  pdf={pdf}
                  pageNum={pageNum}
                  scale={scale}
                  isVisible={!!visiblePages[pageNum]}
                  clipMode={clipMode}
                  onClipCapture={onClipCapture}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="pdf-page-single">
          <div className="pdf-page-content">
            <PdfPage
              pdf={pdf}
              pageNum={currentPage}
              scale={scale}
              isVisible={true}
              clipMode={clipMode}
              onClipCapture={onClipCapture}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default PdfViewer
