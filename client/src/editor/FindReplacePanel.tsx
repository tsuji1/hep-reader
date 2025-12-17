import type { Editor } from '@tiptap/react'
import { useCallback, useState, type ChangeEvent } from 'react'

// Extend Window interface for window.find
declare global {
  interface Window {
    find: (
      str: string,
      caseSensitive?: boolean,
      backwards?: boolean,
      wrapAround?: boolean,
      wholeWord?: boolean,
      searchInFrames?: boolean,
      showDialog?: boolean
    ) => boolean
  }
}

interface FindReplacePanelProps {
  editor: Editor | null
  onClose: () => void
}

export default function FindReplacePanel({ editor, onClose }: FindReplacePanelProps) {
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [useRegex, setUseRegex] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [matchCount, setMatchCount] = useState(0)
  const [currentMatch, setCurrentMatch] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const getRegex = useCallback(() => {
    try {
      setError(null)
      const flags = caseSensitive ? 'g' : 'gi'
      if (useRegex) {
        return new RegExp(findText, flags)
      } else {
        // Escape special regex characters for literal search
        const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(escaped, flags)
      }
    } catch (e) {
      setError('無効な正規表現です')
      return null
    }
  }, [findText, useRegex, caseSensitive])

  const findMatches = useCallback(() => {
    if (!editor || !findText) {
      setMatchCount(0)
      setCurrentMatch(0)
      return []
    }

    const regex = getRegex()
    if (!regex) return []

    const html = editor.getHTML()
    // Create a temporary element to get text content
    const temp = document.createElement('div')
    temp.innerHTML = html
    const textContent = temp.textContent || ''
    
    const matches = textContent.match(regex) || []
    setMatchCount(matches.length)
    return matches
  }, [editor, findText, getRegex])

  const handleFind = useCallback(() => {
    const matches = findMatches()
    if (matches.length > 0) {
      setCurrentMatch(1)
      // Select first match - Tiptap doesn't have built-in find, so we use browser's native
      if (window.find) {
        window.getSelection()?.removeAllRanges()
        window.find(findText, caseSensitive, false, true, false, true, false)
      }
    }
  }, [findMatches, findText, caseSensitive])

  const handleFindNext = useCallback(() => {
    if (!findText) return
    if (window.find) {
      const found = window.find(findText, caseSensitive, false, true, false, true, false)
      if (found) {
        setCurrentMatch(prev => prev < matchCount ? prev + 1 : 1)
      }
    }
  }, [findText, caseSensitive, matchCount])

  const handleFindPrev = useCallback(() => {
    if (!findText) return
    if (window.find) {
      const found = window.find(findText, caseSensitive, true, true, false, true, false)
      if (found) {
        setCurrentMatch(prev => prev > 1 ? prev - 1 : matchCount)
      }
    }
  }, [findText, caseSensitive, matchCount])

  const handleReplace = useCallback(() => {
    if (!editor || !findText) return
    
    const selection = window.getSelection()
    if (!selection || selection.toString() === '') {
      handleFind()
      return
    }

    const selectedText = selection.toString()
    const regex = getRegex()
    if (!regex) return

    // Check if selection matches
    if (useRegex) {
      const match = selectedText.match(regex)
      if (match && match[0] === selectedText) {
        document.execCommand('insertText', false, selectedText.replace(regex, replaceText))
        handleFindNext()
      } else {
        handleFindNext()
      }
    } else {
      const compareA = caseSensitive ? selectedText : selectedText.toLowerCase()
      const compareB = caseSensitive ? findText : findText.toLowerCase()
      if (compareA === compareB) {
        document.execCommand('insertText', false, replaceText)
        handleFindNext()
      } else {
        handleFindNext()
      }
    }
  }, [editor, findText, replaceText, useRegex, caseSensitive, getRegex, handleFind, handleFindNext])

  const handleReplaceAll = useCallback(() => {
    if (!editor || !findText) return

    const regex = getRegex()
    if (!regex) return

    const html = editor.getHTML()
    // For replace all, we need to work with the HTML content carefully
    // Create a regex that skips HTML tags
    let newHtml = html
    let count = 0

    // Simple approach: convert to text, replace, then try to preserve structure
    // This is a simplified implementation
    const parts = html.split(/(<[^>]+>)/g)
    newHtml = parts.map(part => {
      if (part.startsWith('<') && part.endsWith('>')) {
        // This is an HTML tag, don't modify
        return part
      }
      // This is text content, replace
      const matches = part.match(regex)
      if (matches) count += matches.length
      return part.replace(regex, replaceText)
    }).join('')

    if (count > 0) {
      editor.commands.setContent(newHtml)
      setMatchCount(0)
      setCurrentMatch(0)
      alert(`${count}件を置換しました`)
    } else {
      alert('一致するテキストが見つかりませんでした')
    }
  }, [editor, findText, replaceText, getRegex])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        handleFindPrev()
      } else {
        handleFindNext()
      }
    } else if (e.key === 'Escape') {
      onClose()
    }
  }, [handleFindNext, handleFindPrev, onClose])

  return (
    <div className="find-replace-panel">
      <div className="find-replace-header">
        <span>検索と置換</span>
        <button type="button" onClick={onClose} className="close-btn" title="閉じる (Esc)">✕</button>
      </div>
      
      <div className="find-replace-row">
        <input
          type="text"
          placeholder="検索..."
          value={findText}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setFindText(e.target.value)
            setError(null)
          }}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <button type="button" onClick={handleFindPrev} title="前を検索 (Shift+Enter)" disabled={!findText}>◀</button>
        <button type="button" onClick={handleFindNext} title="次を検索 (Enter)" disabled={!findText}>▶</button>
        {matchCount > 0 && <span className="match-count">{currentMatch}/{matchCount}</span>}
      </div>
      
      <div className="find-replace-row">
        <input
          type="text"
          placeholder="置換..."
          value={replaceText}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setReplaceText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="button" onClick={handleReplace} title="置換" disabled={!findText}>置換</button>
        <button type="button" onClick={handleReplaceAll} title="すべて置換" disabled={!findText}>全置換</button>
      </div>
      
      <div className="find-replace-options">
        <label title="大文字/小文字を区別">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          Aa
        </label>
        <label title="正規表現を使用">
          <input
            type="checkbox"
            checked={useRegex}
            onChange={(e) => setUseRegex(e.target.checked)}
          />
          .*
        </label>
      </div>
      
      {error && <div className="find-replace-error">{error}</div>}
    </div>
  )
}
