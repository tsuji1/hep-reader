import axios from 'axios'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import AiChat from '../components/AiChat'
import PdfViewer from '../components/PdfViewer'
import VocabularyPanel from '../components/VocabularyPanel'
import { EditableContent, InsertedNote, InsertNoteButton, type NoteData } from '../editor'
import type { Book, Bookmark, Clip, ClipPosition, Note, PageContent, TocItem, Vocabulary } from '../types'
import { fixEpubImagePaths, openClipInNewWindow, openImageInNewWindow } from '../utils/window'

// Suppress highlight.js warnings for unescaped HTML
hljs.configure({ ignoreUnescapedHTML: true })

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
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false)
  const [showBookmarkModal, setShowBookmarkModal] = useState<boolean>(false)
  const [bookmarkNote, setBookmarkNote] = useState<string>('')
  const [showPageJumpModal, setShowPageJumpModal] = useState<boolean>(false)
  const [jumpPageInput, setJumpPageInput] = useState<string>('')
  const [viewMode, setViewMode] = useState<ViewMode>('scroll')
  const [isPdf, setIsPdf] = useState<boolean>(false)
  const [pdfTotalPages, setPdfTotalPages] = useState<number>(0)
  const [showAiChat, setShowAiChat] = useState<boolean>(false)
  const [pdfPageTexts, setPdfPageTexts] = useState<Map<number, string>>(new Map())

  // クリップ機能
  const [clipMode, setClipMode] = useState<boolean>(false)
  const [showClipModal, setShowClipModal] = useState<boolean>(false)
  const [clipImageData, setClipImageData] = useState<string | null>(null)
  const [clipPageNum, setClipPageNum] = useState<number>(1)
  const [clipNote, setClipNote] = useState<string>('')
  const [clipPosition, setClipPosition] = useState<ClipPosition | null>(null)
  const [generatingDescription, setGeneratingDescription] = useState<boolean>(false)

  // PDFズーム
  const [pdfScale, setPdfScale] = useState<number>(1.5)

  // 翻訳保存
  const [savingTranslation, setSavingTranslation] = useState<boolean>(false)
  const [translatedPages, setTranslatedPages] = useState<Set<number>>(new Set())

  // 編集機能
  const [editMode, setEditMode] = useState<boolean>(false)
  const [notes, setNotes] = useState<Note[]>([])

  // スマホ向けツールバー表示
  const [toolbarVisible, setToolbarVisible] = useState<boolean>(false)
  const lastTapTimeRef = useRef<number>(0)

  // 用語集機能
  const [showVocabulary, setShowVocabulary] = useState<boolean>(false)
  const [vocabularies, setVocabularies] = useState<Vocabulary[]>([])
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null)

  const contentRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const isScrollingToPage = useRef<boolean>(false)
  const initialPageRef = useRef<number>(1)

  // Fetch book info and all pages
  useEffect(() => {
    const fetchBook = async (): Promise<void> => {
      if (!bookId) return

      // Reset initial page ref at the start of fetch
      initialPageRef.current = 1

      try {
        const res = await axios.get<Book>(`/api/books/${bookId}`)
        setBook(res.data)

        // PDFの場合は別処理 (category または original_filename で判定)
        const isPdfBook = res.data.category === 'pdf' ||
          (res.data.original_filename && res.data.original_filename.toLowerCase().endsWith('.pdf'))

        if (isPdfBook) {
          setIsPdf(true)
          // PDFの読み込み進捗を取得
          const progressRes = await axios.get<{ current_page: number }>(`/api/books/${bookId}/progress`)
          const initialPage = progressRes.data.current_page || 1
          setCurrentPage(initialPage)
          fetchBookmarks()
          fetchClips()
          fetchNotes()
          setLoading(false)
          return
        }

        // Fetch all pages (EPUB)
        const pagesRes = await axios.get<{ pages: PageContent[]; total: number }>(`/api/books/${bookId}/all-pages`)
        setPages(pagesRes.data.pages)
        setTotalPages(pagesRes.data.total)

        // Determine initial page from saved progress
        const progressRes = await axios.get<{ current_page: number }>(`/api/books/${bookId}/progress`)
        const initialPage = progressRes.data.current_page || 1
        initialPageRef.current = initialPage
        setCurrentPage(initialPage)

        // Fetch TOC
        const tocRes = await axios.get<{ toc: TocItem[] }>(`/api/books/${bookId}/toc`)
        setToc(tocRes.data.toc || [])

        // Fetch bookmarks, clips, notes and translation status
        fetchBookmarks()
        fetchClips()
        fetchNotes()
        fetchTranslationStatus()
        fetchVocabularies()

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
    if (loading || isPdf) return

    const targetPage = initialPageRef.current
    if (targetPage <= 1 || pages.length === 0) return

    initialPageRef.current = 1 // Reset to prevent re-scrolling

    // Wait for DOM to be ready
    const attemptScroll = (retries: number): void => {
      const pageEl = pageRefs.current[targetPage]
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'auto', block: 'start' })
      } else if (retries > 0) {
        setTimeout(() => attemptScroll(retries - 1), 100)
      }
    }

    requestAnimationFrame(() => {
      attemptScroll(10)
    })
  }, [loading, isPdf, pages.length])

  // Apply syntax highlighting
  useEffect(() => {
    if (!loading && !isPdf) {
      // Use setTimeout to ensure DOM is updated
      setTimeout(() => {
        // はてなブログなどの独自クラス名に対応
        document.querySelectorAll('pre.code').forEach((pre) => {
          if (!pre.querySelector('code')) {
            const code = document.createElement('code');
            code.innerHTML = pre.innerHTML;
            code.className = pre.className;
            pre.innerHTML = '';
            pre.appendChild(code);
          }
        });

        document.querySelectorAll('pre code').forEach((block) => {
          const el = block as HTMLElement

          // 既にハイライト済みの場合はスキップ
          if (el.dataset.highlighted === 'yes') {
            return
          }

          // クラス名がない場合は自動検出を試みる
          if (!block.className && block.parentElement?.className) {
            // 親のpreにクラスがある場合、それを継承する (例: class="code lang-c")
            block.className = block.parentElement.className;
          }

          // lang-xxx を language-xxx に変換
          if (block.className.includes('lang-') && !block.className.includes('language-')) {
            block.className = block.className.replace(/lang-([a-zA-Z0-9_-]+)/, 'language-$1');
          }

          hljs.highlightElement(el)
        })
      }, 100)
    }
  }, [loading, pages, currentPage, viewMode, isPdf])

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

  // 用語ツールチップの位置を動的に調整
  useEffect(() => {
    if (isPdf || !contentRef.current) return

    const handleVocabHover = (e: Event): void => {
      const target = e.target as HTMLElement
      if (!target.classList.contains('vocab-term')) return

      const rect = target.getBoundingClientRect()
      const tooltipWidth = 300 // max-width
      const tooltipHeight = 80 // approximately
      const padding = 10

      // 水平位置を計算
      let left = rect.left + rect.width / 2 - tooltipWidth / 2
      if (left < padding) left = padding
      if (left + tooltipWidth > window.innerWidth - padding) {
        left = window.innerWidth - tooltipWidth - padding
      }

      // 垂直位置: 上に表示するか下に表示するか
      let top: number
      if (rect.top > tooltipHeight + padding + 10) {
        // 上に表示
        top = rect.top - tooltipHeight - 8
      } else {
        // 下に表示
        top = rect.bottom + 8
      }

      // CSS変数で位置を設定
      target.style.setProperty('--tooltip-left', `${left}px`)
      target.style.setProperty('--tooltip-top', `${top}px`)
    }

    const applyTooltipPosition = (): void => {
      const style = document.createElement('style')
      style.id = 'vocab-tooltip-position'
      style.textContent = `
        .vocab-term::after {
          left: var(--tooltip-left, 50%) !important;
          top: var(--tooltip-top, auto) !important;
          transform: none !important;
        }
      `
      if (!document.getElementById('vocab-tooltip-position')) {
        document.head.appendChild(style)
      }
    }
    applyTooltipPosition()

    const container = contentRef.current
    container.addEventListener('mouseenter', handleVocabHover, true)
    return () => {
      container.removeEventListener('mouseenter', handleVocabHover, true)
      const style = document.getElementById('vocab-tooltip-position')
      if (style) style.remove()
    }
  }, [isPdf, loading, vocabularies])

  // スマホ向けダブルタップでツールバー表示
  const handleDoubleTap = useCallback((e: React.TouchEvent): void => {
    // 画像やリンクなど、特定の要素ではダブルタップを無視
    const target = e.target as HTMLElement
    if (target.tagName === 'IMG' || target.tagName === 'A' || target.tagName === 'BUTTON') {
      return
    }

    const now = Date.now()
    const timeDiff = now - lastTapTimeRef.current

    if (timeDiff < 300 && timeDiff > 0) {
      // ダブルタップ検出
      setToolbarVisible(prev => !prev)
      e.preventDefault()
    }
    lastTapTimeRef.current = now
  }, [])

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

  const fetchTranslationStatus = async (): Promise<void> => {
    try {
      const res = await axios.get<{ translatedPages: number[]; totalTranslated: number }>(
        `/api/books/${bookId}/translation-status`
      )
      setTranslatedPages(new Set(res.data.translatedPages))
    } catch (error) {
      // 翻訳状態の取得に失敗しても致命的ではない
      console.error('Failed to fetch translation status:', error)
    }
  }

  const fetchVocabularies = async (): Promise<void> => {
    try {
      const res = await axios.get<Vocabulary[]>('/api/vocabularies')
      const data = Array.isArray(res.data) ? res.data : []
      setVocabularies(data)
    } catch (error) {
      console.error('Failed to fetch vocabularies:', error)
      setVocabularies([])
    }
  }

  // 用語をハイライトしたHTMLを生成
  const highlightVocabularies = useCallback((html: string): string => {
    if (vocabularies.length === 0) return html

    let result = html
    // タグ内のテキストを置換しないよう、正規表現で処理
    for (const vocab of vocabularies) {
      // 無効なデータをスキップ
      if (!vocab || !vocab.term || !vocab.description) continue

      // タグの外のテキストのみを置換（単純な実装）
      const escapedTerm = vocab.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // 説明文をHTMLエスケープ
      const escapedDescription = vocab.description
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
      const regex = new RegExp(`(?<![<][^>]*)(${escapedTerm})(?![^<]*[>])`, 'g')
      result = result.replace(regex, `<span class="vocab-term" data-vocab-id="${vocab.id}" data-description="${escapedDescription}" tabindex="0">$1</span>`)
    }
    return result
  }, [vocabularies])

  const fetchNotes = async (): Promise<void> => {
    try {
      const res = await axios.get<Note[]>(`/api/books/${bookId}/notes`)
      setNotes(res.data)
    } catch (error) {
      console.error('Failed to fetch notes:', error)
    }
  }

  // ノートを保存
  const saveNote = async (noteData: NoteData): Promise<void> => {
    await axios.put(`/api/notes/${noteData.id}`, {
      content: noteData.content
    })
    await fetchNotes()
  }

  // ノートを削除
  const deleteNote = async (noteId: string): Promise<void> => {
    await axios.delete(`/api/notes/${noteId}`)
    await fetchNotes()
  }

  // 新しいノートを追加
  const addNote = async (pageNum: number): Promise<void> => {
    const notesOnPage = notes.filter(n => n.page_num === pageNum)
    const position = notesOnPage.length > 0
      ? Math.max(...notesOnPage.map(n => n.position)) + 1
      : 0

    await axios.post(`/api/books/${bookId}/notes`, {
      pageNum,
      content: '',
      position
    })
    await fetchNotes()
  }

  // EPUB/Webのコンテンツを保存
  const savePageContent = async (pageNum: number, content: string): Promise<void> => {
    await axios.post(`/api/books/${bookId}/page/${pageNum}/save-edit`, {
      content
    })
    // ページを再取得して更新を反映
    const pagesRes = await axios.get<{ pages: PageContent[]; total: number }>(`/api/books/${bookId}/all-pages`)
    setPages(pagesRes.data.pages)
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
    // サーバーにPDF総ページ数を保存（進捗計算用）
    axios.post(`/api/books/${bookId}/pdf-total-pages`, { totalPages: total })
      .catch(err => console.error('Failed to save PDF total pages:', err))
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

  // AI説明生成
  const generateDescription = async (): Promise<void> => {
    if (!book) return
    setGeneratingDescription(true)
    try {
      const pageContent = getCurrentPageContext()
      const res = await axios.post<{ description: string }>('/api/ai/generate-clip-description', {
        bookTitle: book.title,
        pageContent
      })
      if (res.data.description) {
        setClipNote(res.data.description)
      }
    } catch (error) {
      console.error('Failed to generate description:', error)
      alert('説明の生成に失敗しました。AI設定を確認してください。')
    } finally {
      setGeneratingDescription(false)
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

  // 翻訳されたページを保存
  const saveTranslation = async (): Promise<void> => {
    if (!contentRef.current || isPdf) return

    setSavingTranslation(true)
    try {
      // 現在表示されているページのHTMLを取得
      let pageElement: HTMLElement | null = null

      if (viewMode === 'scroll') {
        // スクロールモード: 現在のページセクションを取得
        pageElement = pageRefs.current[currentPage]
      } else {
        // ページモード: コンテンツ全体を取得
        pageElement = contentRef.current.querySelector('.content-single-page')
      }

      if (!pageElement) {
        alert('ページコンテンツが見つかりません')
        return
      }

      // content-html部分のHTMLを取得（翻訳されたテキストを含む）
      const contentHtml = pageElement.querySelector('.content-html')
      if (!contentHtml) {
        alert('コンテンツが見つかりません')
        return
      }

      // HTMLを取得し、完全なページとして構築
      const bodyContent = contentHtml.innerHTML
      const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${book?.title} - Page ${currentPage}</title>
  <style>
    body { 
      font-family: 'Noto Sans JP', 'Hiragino Sans', sans-serif;
      line-height: 1.8;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: #fafafa;
      color: #333;
    }
    img { max-width: 100%; height: auto; }
    pre { background: #f4f4f4; padding: 15px; overflow-x: auto; border-radius: 5px; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
    h1, h2, h3 { color: #2c3e50; }
    a { color: #3498db; }
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`

      // サーバーに送信
      await axios.post(`/api/books/${bookId}/page/${currentPage}/save-translation`, {
        content: fullHtml
      })

      // 翻訳済みページに追加
      setTranslatedPages(prev => new Set([...prev, currentPage]))

      alert(`ページ ${currentPage} の翻訳を保存しました！`)
    } catch (error: unknown) {
      console.error('Failed to save translation:', error)
      const axiosError = error as { response?: { data?: { error?: string } } }
      alert(axiosError.response?.data?.error || '翻訳の保存に失敗しました')
    } finally {
      setSavingTranslation(false)
    }
  }

  // 全ページの翻訳を一括保存
  const saveAllTranslations = async (): Promise<void> => {
    if (!contentRef.current || isPdf || viewMode !== 'scroll') {
      alert('スクロールモードで全ページを表示してから実行してください')
      return
    }

    if (!confirm(`全 ${totalPages} ページの翻訳を保存しますか？\n（Google翻訳などで翻訳した後に実行してください）`)) {
      return
    }

    setSavingTranslation(true)
    let savedCount = 0

    try {
      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const pageElement = pageRefs.current[pageNum]
        if (!pageElement) continue

        const contentHtml = pageElement.querySelector('.content-html')
        if (!contentHtml) continue

        const bodyContent = contentHtml.innerHTML
        const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${book?.title} - Page ${pageNum}</title>
  <style>
    body { 
      font-family: 'Noto Sans JP', 'Hiragino Sans', sans-serif;
      line-height: 1.8;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: #fafafa;
      color: #333;
    }
    img { max-width: 100%; height: auto; }
    pre { background: #f4f4f4; padding: 15px; overflow-x: auto; border-radius: 5px; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
    h1, h2, h3 { color: #2c3e50; }
    a { color: #3498db; }
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`

        await axios.post(`/api/books/${bookId}/page/${pageNum}/save-translation`, {
          content: fullHtml
        })
        savedCount++
      }

      // 翻訳状態を更新
      await fetchTranslationStatus()

      alert(`${savedCount} ページの翻訳を保存しました！\nリロードすると翻訳版が表示されます。`)
    } catch (error: unknown) {
      console.error('Failed to save translations:', error)
      const axiosError = error as { response?: { data?: { error?: string } } }
      alert(`保存中にエラーが発生しました（${savedCount}ページ保存済み）\n${axiosError.response?.data?.error || ''}`)
    } finally {
      setSavingTranslation(false)
    }
  }

  // 翻訳を元に戻す（全ページ）
  const restoreAllTranslations = async (): Promise<void> => {
    if (translatedPages.size === 0) {
      alert('翻訳保存されたページがありません')
      return
    }

    if (!confirm(`${translatedPages.size} ページの翻訳を元に戻しますか？\n（元の言語に戻ります）`)) {
      return
    }

    setSavingTranslation(true)
    try {
      await axios.post(`/api/books/${bookId}/restore-all-translations`)
      setTranslatedPages(new Set())
      alert('全ページを元に戻しました。リロードしてください。')
      window.location.reload()
    } catch (error: unknown) {
      console.error('Failed to restore translations:', error)
      const axiosError = error as { response?: { data?: { error?: string } } }
      alert(axiosError.response?.data?.error || '復元に失敗しました')
    } finally {
      setSavingTranslation(false)
    }
  }

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

  // Fix image paths in content and highlight vocabularies
  const fixContent = (content: string): string => {
    const fixed = fixEpubImagePaths(content, bookId || '')
    return highlightVocabularies(fixed)
  }

  // 現在のページのコンテンツをAIのコンテキストとして取得（前後2ページ含む）
  const getCurrentPageContext = (): string => {
    // 事前説明があれば追加
    const preContext = book?.ai_context
      ? `\n【この本についての事前情報】\n${book.ai_context}\n\n`
      : ''

    if (isPdf) {
      // PDFの場合はテキストを抽出して渡す
      const pageRange = [-2, -1, 0, 1, 2]
      const contextPages: string[] = []

      for (const offset of pageRange) {
        const pageNum = currentPage + offset
        if (pageNum >= 1 && pageNum <= pdfTotalPages) {
          const text = pdfPageTexts.get(pageNum)
          if (text && text.trim()) {
            const label = offset === 0 ? '【現在のページ】' : `【${offset > 0 ? '+' : ''}${offset}ページ】`
            contextPages.push(`${label} (p.${pageNum})\n${text}`)
          }
        }
      }

      if (contextPages.length > 0) {
        const allContent = contextPages.join('\n\n---\n\n')
        const maxLength = 6000
        const truncated = allContent.length > maxLength
          ? allContent.slice(0, maxLength) + '...'
          : allContent

        return `${preContext}PDF文書のタイトル: ${book?.title}\n現在のページ: ${currentPage} / ${pdfTotalPages}\n\n${truncated}`
      }

      return `${preContext}PDF文書「${book?.title}」の${currentPage}ページ目を閲覧中です。（テキスト抽出中...）`
    }

    // 現在ページ ± 2ページ分のコンテンツを取得
    const pageRange = [-2, -1, 0, 1, 2]
    const contextPages: string[] = []

    for (const offset of pageRange) {
      const pageIndex = currentPage - 1 + offset
      if (pageIndex >= 0 && pageIndex < pages.length) {
        const pageData = pages[pageIndex]
        if (pageData) {
          // HTMLタグを除去してテキストのみ抽出
          const textContent = pageData.content
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()

          if (textContent) {
            const label = offset === 0 ? '【現在のページ】' : `【${offset > 0 ? '+' : ''}${offset}ページ】`
            contextPages.push(`${label} (p.${pageIndex + 1})\n${textContent}`)
          }
        }
      }
    }

    const allContent = contextPages.join('\n\n---\n\n')

    // 長すぎる場合は切り取り
    const maxLength = 6000
    const truncated = allContent.length > maxLength
      ? allContent.slice(0, maxLength) + '...'
      : allContent

    return `${preContext}本のタイトル: ${book?.title}\n現在のページ: ${currentPage} / ${totalPages}\n\n${truncated}`
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
          {book.source_url && (
            <a
              href={book.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block',
                marginTop: '8px',
                color: '#667eea',
                fontSize: '0.8rem',
                textDecoration: 'none',
                wordBreak: 'break-all'
              }}
            >
              🔗 元の記事を開く
            </a>
          )}
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
        <div
          className={`reader-toolbar-area ${toolbarVisible ? 'toolbar-visible' : ''}`}
          onTouchEnd={() => {
            // ツールバー内のタッチでは閉じない（タッチイベントの伝播確認後に自動で閉じる処理を追加可能）
          }}
        >
          <div className="reader-toolbar-trigger" />
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
                <>
                  <button
                    className={`clip-btn ${clipMode ? 'active' : ''}`}
                    onClick={() => setClipMode(!clipMode)}
                    title={clipMode ? 'クリップモード終了' : '範囲選択してクリップ'}
                  >
                    📷 クリップ
                  </button>
                  <button
                    className="secondary"
                    onClick={() => addNote(currentPage)}
                    title="現在のページにノートを追加"
                    style={{ fontSize: '0.85rem', padding: '6px 10px' }}
                  >
                    ✏️ ノート追加
                  </button>
                </>
              )}

              {isPdf && (
                <div className="pdf-zoom-controls">
                  <button
                    onClick={() => setPdfScale(s => Math.max(0.5, s - 0.25))}
                    title="縮小"
                  >
                    −
                  </button>
                  <span>{Math.round(pdfScale * 100)}%</span>
                  <button
                    onClick={() => setPdfScale(s => Math.min(3, s + 0.25))}
                    title="拡大"
                  >
                    +
                  </button>
                </div>
              )}

              {clipMode && (
                <span className="clip-mode-indicator">📷 ドラッグで選択</span>
              )}

              {/* 編集モードボタン（EPUB/Webのみ） */}
              {!isPdf && (
                <button
                  className={`secondary ${editMode ? 'active' : ''}`}
                  onClick={() => setEditMode(!editMode)}
                  title={editMode ? '編集モードを終了' : '編集モードに切り替え'}
                  style={{
                    fontSize: '0.85rem',
                    padding: '6px 10px',
                    background: editMode ? '#22c55e' : undefined,
                    color: editMode ? 'white' : undefined
                  }}
                >
                  ✏️ {editMode ? '編集中' : '編集'}
                </button>
              )}

              {/* 翻訳保存ボタン（EPUB/Webのみ） */}
              {!isPdf && (
                <div className="translation-controls" style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                  {/* 現在のページの翻訳状態 */}
                  {translatedPages.has(currentPage) ? (
                    <span
                      style={{
                        fontSize: '0.8rem',
                        padding: '4px 8px',
                        background: '#dcfce7',
                        color: '#166534',
                        borderRadius: '4px'
                      }}
                      title="このページは翻訳保存済みです"
                    >
                      ✅ 翻訳済
                    </span>
                  ) : (
                    <button
                      className="secondary"
                      onClick={saveTranslation}
                      disabled={savingTranslation}
                      title="現在のページの翻訳を保存"
                      style={{ fontSize: '0.85rem', padding: '6px 10px' }}
                    >
                      {savingTranslation ? '⏳' : '💾'} 翻訳保存
                    </button>
                  )}

                  {/* 全保存ボタン */}
                  <button
                    className="secondary"
                    onClick={saveAllTranslations}
                    disabled={savingTranslation || viewMode !== 'scroll'}
                    title="全ページの翻訳を一括保存（スクロールモードのみ）"
                    style={{ fontSize: '0.85rem', padding: '6px 10px' }}
                  >
                    📥 全保存
                  </button>

                  {/* 翻訳済みページがある場合は復元ボタンを表示 */}
                  {translatedPages.size > 0 && (
                    <button
                      className="secondary"
                      onClick={restoreAllTranslations}
                      disabled={savingTranslation}
                      title={`${translatedPages.size}ページの翻訳を元に戻す`}
                      style={{
                        fontSize: '0.85rem',
                        padding: '6px 10px',
                        background: '#fef3c7',
                        color: '#92400e'
                      }}
                    >
                      🔄 復元 ({translatedPages.size})
                    </button>
                  )}
                </div>
              )}

              {/* 用語集ボタン（EPUB/Webのみ） */}
              {!isPdf && (
                <button
                  className={`secondary ${showVocabulary ? 'active' : ''}`}
                  onClick={() => setShowVocabulary(!showVocabulary)}
                  title="用語集を開く"
                  style={{
                    fontSize: '0.85rem',
                    padding: '6px 10px',
                    background: showVocabulary ? '#667eea' : undefined,
                    color: showVocabulary ? 'white' : undefined
                  }}
                >
                  📖 用語集 {vocabularies.length > 0 && `(${vocabularies.length})`}
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
        </div>

        <div className="reader-content" ref={contentRef} onTouchEnd={handleDoubleTap}>
          {loading ? (
            <div className="loading">読み込み中</div>
          ) : isPdf ? (
            <div className="pdf-with-notes">
              <PdfViewer
                pdfUrl={`/api/books/${bookId}/pdf`}
                currentPage={currentPage}
                onPageChange={handlePdfPageChange}
                onTotalPagesChange={handlePdfTotalPages}
                onPageTextExtracted={setPdfPageTexts}
                viewMode={viewMode}
                clipMode={clipMode}
                onClipCapture={handleClipCapture}
                clips={clips}
                onClipClick={openClipInNewWindow}
                scale={pdfScale}
                scrollContainerRef={contentRef}
                notes={notes.map(n => ({
                  id: n.id,
                  bookId: n.book_id,
                  pageNum: n.page_num,
                  content: n.content,
                  position: n.position,
                  createdAt: n.created_at,
                  updatedAt: n.updated_at
                }))}
                onAddNote={addNote}
                onSaveNote={saveNote}
                onDeleteNote={deleteNote}
              />

              {/* ページモード用のノート表示 */}
              {viewMode === 'page' && (
                <div className="pdf-notes-section">
                  {notes.filter(n => n.page_num === currentPage).map(note => (
                    <InsertedNote
                      key={note.id}
                      note={{
                        id: note.id,
                        bookId: note.book_id,
                        pageNum: note.page_num,
                        content: note.content,
                        position: note.position,
                        createdAt: note.created_at,
                        updatedAt: note.updated_at
                      }}
                      onSave={saveNote}
                      onDelete={deleteNote}
                    />
                  ))}
                  <InsertNoteButton onClick={() => addNote(currentPage)} />
                </div>
              )}
            </div>
          ) : viewMode === 'scroll' ? (
            <div className="content-continuous">
              {pages.map((page) => {
                const pageNotes = notes.filter(n => n.page_num === page.pageNum)
                return (
                  <div
                    key={page.pageNum}
                    ref={(el) => { pageRefs.current[page.pageNum] = el }}
                    className={`page-section ${page.pageNum === currentPage ? 'current' : ''}`}
                    data-page={page.pageNum}
                  >
                    {editMode ? (
                      <EditableContent
                        content={fixContent(page.content)}
                        pageNum={page.pageNum}
                        bookId={bookId || ''}
                        onSave={savePageContent}
                        lang={book.language || 'en'}
                      />
                    ) : (
                      <div
                        className="content-html clickable-images"
                        lang={book.language || 'en'}
                        dangerouslySetInnerHTML={{ __html: fixContent(page.content) }}
                      />
                    )}

                    {/* 差し込みノート */}
                    {pageNotes.map(note => (
                      <InsertedNote
                        key={note.id}
                        note={{
                          id: note.id,
                          bookId: note.book_id,
                          pageNum: note.page_num,
                          content: note.content,
                          position: note.position,
                          createdAt: note.created_at,
                          updatedAt: note.updated_at
                        }}
                        onSave={saveNote}
                        onDelete={deleteNote}
                      />
                    ))}

                    {/* ノート追加ボタン */}
                    <InsertNoteButton onClick={() => addNote(page.pageNum)} />
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="content-single-page">
              {pages[currentPage - 1] && (
                <>
                  {editMode ? (
                    <EditableContent
                      content={fixContent(pages[currentPage - 1].content)}
                      pageNum={currentPage}
                      bookId={bookId || ''}
                      onSave={savePageContent}
                      lang={book.language || 'en'}
                    />
                  ) : (
                    <div
                      className="content-html clickable-images"
                      lang={book.language || 'en'}
                      dangerouslySetInnerHTML={{ __html: fixContent(pages[currentPage - 1].content) }}
                    />
                  )}

                  {/* 差し込みノート */}
                  {notes.filter(n => n.page_num === currentPage).map(note => (
                    <InsertedNote
                      key={note.id}
                      note={{
                        id: note.id,
                        bookId: note.book_id,
                        pageNum: note.page_num,
                        content: note.content,
                        position: note.position,
                        createdAt: note.created_at,
                        updatedAt: note.updated_at
                      }}
                      onSave={saveNote}
                      onDelete={deleteNote}
                    />
                  ))}

                  {/* ノート追加ボタン */}
                  <InsertNoteButton onClick={() => addNote(currentPage)} />
                </>
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
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '10px' }}>
              <textarea
                placeholder="メモ (任意)"
                value={clipNote}
                onChange={(e) => setClipNote(e.target.value)}
                rows={2}
                style={{ flex: 1 }}
              />
              <button
                onClick={generateDescription}
                disabled={generatingDescription}
                title="AIで説明を生成"
                style={{
                  padding: '8px 12px',
                  background: generatingDescription ? '#ccc' : '#667eea',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: generatingDescription ? 'wait' : 'pointer',
                  fontSize: '1rem'
                }}
              >
                {generatingDescription ? '⏳' : '✨'}
              </button>
            </div>
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

      {/* AI Chat */}
      {showAiChat ? (
        <AiChat
          context={getCurrentPageContext()}
          onClose={() => setShowAiChat(false)}
          aiContext={book.ai_context || ''}
          onAiContextChange={async (newContext) => {
            try {
              await axios.patch(`/api/books/${bookId}`, { ai_context: newContext })
              setBook(prev => prev ? { ...prev, ai_context: newContext } : prev)
            } catch (error) {
              console.error('Failed to update AI context:', error)
              alert('保存に失敗しました')
            }
          }}
        />
      ) : (
        <button
          className="ai-chat-toggle"
          onClick={() => setShowAiChat(true)}
          title="AIに質問"
        >
          🤖
        </button>
      )}

      {/* Vocabulary Panel */}
      {showVocabulary && (
        <VocabularyPanel
          onClose={() => setShowVocabulary(false)}
          onVocabulariesChange={setVocabularies}
        />
      )}

      {/* Vocabulary Tooltip */}
      {activeTooltip && (
        <div
          className="vocab-tooltip"
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)'
          }}
        >
          {vocabularies.find(v => v.id === activeTooltip)?.description}
        </div>
      )}
    </div>
  )
}

export default Reader
