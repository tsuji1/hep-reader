import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { Clip, ClipPosition } from '../types'

// PDF.js worker設定
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

// 日本語フォント用CMap設定
const CMAP_URL = 'https://unpkg.com/pdfjs-dist@4.4.168/cmaps/'
const CMAP_PACKED = true

interface PdfPageProps {
  pdf: pdfjsLib.PDFDocumentProxy
  pageNum: number
  scale: number
  isVisible: boolean
  clipMode: boolean
  onClipCapture?: (pageNum: number, imageData: string, position: ClipPosition) => void
  clips?: Clip[]
  onClipClick?: (clip: Clip) => void
}

interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

// 個別ページコンポーネント
function PdfPage({ pdf, pageNum, scale, isVisible, clipMode, onClipCapture, clips, onClipClick }: PdfPageProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [rendered, setRendered] = useState<boolean>(false)
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null)
  const currentScaleRef = useRef<number>(scale)

  // 高解像度対応の倍率
  const pixelRatio = window.devicePixelRatio || 1

  // クリップ選択状態
  const [isSelecting, setIsSelecting] = useState<boolean>(false)
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null)
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null)
  const [lastSelection, setLastSelection] = useState<SelectionRect | null>(null)

  // このページのクリップをフィルタ
  const pageClips = clips?.filter(c => c.page_num === pageNum) || []

  // クリップ選択ハンドラー
  const handleMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (!clipMode) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setIsSelecting(true)
    setSelectionStart({ x, y })
    setSelectionEnd({ x, y })
    setLastSelection(null)
  }

  const handleMouseMove = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (!isSelecting || !clipMode) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height))
    setSelectionEnd({ x, y })
  }

  const handleMouseUp = (): void => {
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
      // 選択範囲を保持（枠を表示し続ける）
      setLastSelection({ x, y, width, height })

      try {
        // キャンバスから選択範囲を切り出し（高解像度対応）
        const canvas = canvasRef.current
        const tempCanvas = document.createElement('canvas')
        // 高解像度でキャプチャ
        tempCanvas.width = width * pixelRatio
        tempCanvas.height = height * pixelRatio
        const ctx = tempCanvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(
            canvas,
            x * pixelRatio, y * pixelRatio, width * pixelRatio, height * pixelRatio,
            0, 0, width * pixelRatio, height * pixelRatio
          )
          const imageData = tempCanvas.toDataURL('image/png')

          if (onClipCapture) {
            // 選択位置情報も一緒に渡す（ページサイズに対する比率で保存）
            const positionInfo: ClipPosition = {
              xRatio: x / pageSize.width,
              yRatio: y / pageSize.height,
              widthRatio: width / pageSize.width,
              heightRatio: height / pageSize.height
            }
            onClipCapture(pageNum, imageData, positionInfo)
          }
        }
      } catch (err) {
        console.error('クリップキャプチャエラー:', err)
      }
    }

    setIsSelecting(false)
    setSelectionStart(null)
    setSelectionEnd(null)
  }

  // クリップモードを解除したら選択枠もクリア
  useEffect(() => {
    if (!clipMode) {
      setLastSelection(null)
    }
  }, [clipMode])

  // 選択範囲の矩形を計算
  const getSelectionRect = (): { left: number; top: number; width: number; height: number } | null => {
    if (isSelecting && selectionStart && selectionEnd) {
      return {
        left: Math.min(selectionStart.x, selectionEnd.x),
        top: Math.min(selectionStart.y, selectionEnd.y),
        width: Math.abs(selectionEnd.x - selectionStart.x),
        height: Math.abs(selectionEnd.y - selectionStart.y)
      }
    }
    if (lastSelection) {
      return {
        left: lastSelection.x,
        top: lastSelection.y,
        width: lastSelection.width,
        height: lastSelection.height
      }
    }
    return null
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

    const renderPage = async (): Promise<void> => {
      try {
        const page = await pdf.getPage(pageNum)
        const viewport = page.getViewport({ scale })

        setPageSize({ width: viewport.width, height: viewport.height })

        const canvas = canvasRef.current
        if (!canvas) return

        const context = canvas.getContext('2d')
        if (!context) return

        // 高解像度対応：canvasの実際のサイズを大きくし、CSSで表示サイズを設定
        canvas.width = viewport.width * pixelRatio
        canvas.height = viewport.height * pixelRatio
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`

        // コンテキストをスケール
        context.scale(pixelRatio, pixelRatio)

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
              if ('transform' in item && 'str' in item) {
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
              }
            })
          }
        } catch (e) {
          // テキストレイヤーの追加に失敗しても続行
          console.warn('Text layer failed:', e)
        }

        setRendered(true)
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'name' in error && error.name !== 'RenderingCancelledException') {
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
      {clipMode && selectionRect && (
        <div
          className="clip-selection-overlay"
          style={{
            position: 'absolute',
            left: selectionRect.left,
            top: selectionRect.top,
            width: selectionRect.width,
            height: selectionRect.height,
            border: lastSelection ? '3px solid #28a745' : '2px dashed #007bff',
            backgroundColor: lastSelection ? 'rgba(40, 167, 69, 0.15)' : 'rgba(0, 123, 255, 0.2)',
            pointerEvents: 'none',
            boxSizing: 'border-box'
          }}
        >
          {lastSelection && (
            <div style={{
              position: 'absolute',
              top: '-24px',
              left: '0',
              background: '#28a745',
              color: 'white',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              whiteSpace: 'nowrap'
            }}>
              ✓ 保存済み
            </div>
          )}
        </div>
      )}
      {/* 保存済みクリップのマーカー */}
      {pageClips.map((clip) => {
        // 位置情報がある場合はその位置に、なければ左上に表示
        const hasPosition = clip.x_ratio != null && clip.y_ratio != null
        const markerStyle: React.CSSProperties = hasPosition ? {
          position: 'absolute',
          left: `${(clip.x_ratio || 0) * 100}%`,
          top: `${(clip.y_ratio || 0) * 100}%`,
          zIndex: 10
        } : {
          position: 'absolute',
          left: '10px',
          top: `${10 + pageClips.indexOf(clip) * 35}px`,
          zIndex: 10
        }

        return (
          <button
            key={clip.id}
            className="clip-marker-btn"
            style={markerStyle}
            onClick={(e) => {
              e.stopPropagation()
              if (onClipClick) onClipClick(clip)
            }}
            title={clip.note || 'クリップを開く'}
          >
            📷
          </button>
        )
      })}
    </div>
  )
}

interface PdfViewerProps {
  pdfUrl: string
  currentPage: number
  onPageChange: (page: number) => void
  onTotalPagesChange?: (total: number) => void
  onPageTextExtracted?: (pageTexts: Map<number, string>) => void
  viewMode: 'scroll' | 'page'
  clipMode: boolean
  onClipCapture?: (pageNum: number, imageData: string, position: ClipPosition) => void
  clips?: Clip[]
  onClipClick?: (clip: Clip) => void
  scale: number
}

function PdfViewer({ pdfUrl, currentPage, onPageChange, onTotalPagesChange, onPageTextExtracted, viewMode, clipMode, onClipCapture, clips, onClipClick, scale }: PdfViewerProps): JSX.Element {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [totalPages, setTotalPages] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(true)
  const [visiblePages, setVisiblePages] = useState<Record<number, boolean>>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const isScrollingToPage = useRef<boolean>(false)
  const pageTextsRef = useRef<Map<number, string>>(new Map())

  // PDFを読み込み
  useEffect(() => {
    let isMounted = true

    const loadPdf = async (): Promise<void> => {
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

        // テキスト抽出（現在ページ周辺）
        if (onPageTextExtracted) {
          const extractTexts = async () => {
            const pageRange = [currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2]
            for (const pageNum of pageRange) {
              if (pageNum >= 1 && pageNum <= pdfDoc.numPages && !pageTextsRef.current.has(pageNum)) {
                try {
                  const page = await pdfDoc.getPage(pageNum)
                  const textContent = await page.getTextContent()
                  const text = textContent.items
                    .filter((item): item is { str: string } => 'str' in item)
                    .map(item => item.str)
                    .join(' ')
                  pageTextsRef.current.set(pageNum, text)
                } catch (e) {
                  console.warn(`Failed to extract text from page ${pageNum}:`, e)
                }
              }
            }
            onPageTextExtracted(pageTextsRef.current)
          }
          extractTexts()
        }

        // 初期表示ページを設定
        const initialVisible: Record<number, boolean> = {}
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

  // ページ変更時にテキスト抽出
  useEffect(() => {
    if (!pdf || !onPageTextExtracted) return

    const extractTexts = async () => {
      const pageRange = [currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2]
      let hasNew = false
      for (const pageNum of pageRange) {
        if (pageNum >= 1 && pageNum <= totalPages && !pageTextsRef.current.has(pageNum)) {
          try {
            const page = await pdf.getPage(pageNum)
            const textContent = await page.getTextContent()
            const text = textContent.items
              .filter((item): item is { str: string } => 'str' in item)
              .map(item => item.str)
              .join(' ')
            pageTextsRef.current.set(pageNum, text)
            hasNew = true
          } catch (e) {
            console.warn(`Failed to extract text from page ${pageNum}:`, e)
          }
        }
      }
      if (hasNew) {
        onPageTextExtracted(pageTextsRef.current)
      }
    }
    extractTexts()
  }, [currentPage, pdf, totalPages, onPageTextExtracted])

  // スクロールモード時のIntersection Observer
  useEffect(() => {
    if (viewMode !== 'scroll' || !pdf) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const pageNum = parseInt((entry.target as HTMLElement).dataset.page || '0', 10)
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

  // スクロール時のページ検出（スクロールによる変更時はスクロール処理をスキップ）
  const isScrollDetectedChange = useRef<boolean>(false)
  useEffect(() => {
    if (viewMode !== 'scroll') return

    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const handleScroll = (): void => {
      if (isScrollingToPage.current || !containerRef.current) return

      // デバウンス：200ms待ってからページ変更を通知
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const container = containerRef.current
        if (!container) return

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
          // スクロールによる変更であることをマーク
          isScrollDetectedChange.current = true
          onPageChange(closestPage)
        }
      }, 200)
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true })
      return () => {
        container.removeEventListener('scroll', handleScroll)
        if (debounceTimer) clearTimeout(debounceTimer)
      }
    }
  }, [currentPage, totalPages, viewMode, onPageChange])

  // ページへスクロール
  const scrollToPage = useCallback((page: number): void => {
    const pageEl = pageRefs.current[page]
    if (pageEl && containerRef.current) {
      isScrollingToPage.current = true
      pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setTimeout(() => {
        isScrollingToPage.current = false
      }, 500)
    }
  }, [])

  // 初期ページへのスクロール（PDFロード完了後）
  const initialPageRef = useRef<number>(currentPage)
  const hasInitialScrolled = useRef<boolean>(false)

  useEffect(() => {
    // PDFロード完了後、初期ページにスクロール
    if (!loading && pdf && viewMode === 'scroll' && !hasInitialScrolled.current && initialPageRef.current > 1) {
      hasInitialScrolled.current = true
      setTimeout(() => {
        const pageEl = pageRefs.current[initialPageRef.current]
        if (pageEl) {
          pageEl.scrollIntoView({ behavior: 'auto', block: 'start' })
        }
      }, 100)
    }
  }, [loading, pdf, viewMode])

  // currentPageが変わったらスクロール（外部からのページ変更時のみ）
  const lastExternalPage = useRef<number>(currentPage)
  useEffect(() => {
    // ページモード時はスクロール不要（単一ページ表示）
    if (viewMode === 'page') {
      lastExternalPage.current = currentPage
      return
    }

    // スクロール検出による変更の場合はスクロールしない
    if (isScrollDetectedChange.current) {
      isScrollDetectedChange.current = false
      lastExternalPage.current = currentPage
      return
    }

    // 初期スクロール中はスキップ
    if (!hasInitialScrolled.current && initialPageRef.current > 1) {
      lastExternalPage.current = currentPage
      return
    }

    // 外部からページが変更された場合のみスクロール（ナビボタン等）
    if (currentPage !== lastExternalPage.current && pageRefs.current[currentPage]) {
      scrollToPage(currentPage)
      lastExternalPage.current = currentPage
    }
  }, [currentPage, viewMode, scrollToPage])

  if (loading) {
    return <div className="loading">PDF読み込み中...</div>
  }

  if (!pdf) {
    return <div className="loading">PDFを読み込めませんでした</div>
  }

  return (
    <div className="pdf-viewer-container" ref={containerRef}>
      {viewMode === 'scroll' ? (
        <div className="pdf-pages-scroll">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
            <div
              key={pageNum}
              ref={el => { pageRefs.current[pageNum] = el }}
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
                  clips={clips}
                  onClipClick={onClipClick}
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
              clips={clips}
              onClipClick={onClipClick}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default PdfViewer
