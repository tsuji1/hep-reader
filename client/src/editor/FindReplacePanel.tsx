import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'

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
  const [matches, setMatches] = useState<Array<{ start: number; end: number; text: string }>>([])

  const getRegex = useCallback(() => {
    try {
      setError(null)
      if (!findText) return null
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

  // Find all matches in the editor content
  const findAllMatches = useCallback(() => {
    if (!editor || !findText) {
      setMatchCount(0)
      setCurrentMatch(0)
      setMatches([])
      return
    }

    const regex = getRegex()
    if (!regex) {
      setMatchCount(0)
      setCurrentMatch(0)
      setMatches([])
      return
    }

    const html = editor.getHTML()
    // Create a temporary element to get text content
    const temp = document.createElement('div')
    temp.innerHTML = html
    const textContent = temp.textContent || ''
    
    const foundMatches: Array<{ start: number; end: number; text: string }> = []
    let match
    while ((match = regex.exec(textContent)) !== null) {
      foundMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0]
      })
      // Prevent infinite loop for zero-length matches
      if (match[0].length === 0) regex.lastIndex++
    }
    
    setMatches(foundMatches)
    setMatchCount(foundMatches.length)
    if (foundMatches.length > 0 && currentMatch === 0) {
      setCurrentMatch(1)
    } else if (foundMatches.length === 0) {
      setCurrentMatch(0)
    }
  }, [editor, findText, getRegex, currentMatch])

  // Update matches when search parameters change
  useEffect(() => {
    findAllMatches()
  }, [findText, useRegex, caseSensitive, findAllMatches])

  const selectMatch = useCallback((matchIndex: number) => {
    if (!editor || matches.length === 0 || matchIndex < 0 || matchIndex >= matches.length) {
      return
    }

    // Use Tiptap's text selection to select the match
    const match = matches[matchIndex]
    
    // Focus on the editor content area
    const editorElement = document.querySelector('.tiptap-content .ProseMirror') as HTMLElement
    if (editorElement) {
      editorElement.focus()
      
      // Use window selection to find and select the text
      // This is a simplified approach - find the text node containing the match
      const selection = window.getSelection()
      if (selection) {
        selection.removeAllRanges()
        
        // Walk through text nodes to find the match position
        const walker = document.createTreeWalker(
          editorElement,
          NodeFilter.SHOW_TEXT,
          null
        )
        
        let currentPos = 0
        let node = walker.nextNode()
        
        while (node) {
          const nodeText = node.textContent || ''
          const nodeStart = currentPos
          const nodeEnd = currentPos + nodeText.length
          
          if (match.start >= nodeStart && match.start < nodeEnd) {
            // Match starts in this node
            const startOffset = match.start - nodeStart
            const endOffset = Math.min(startOffset + match.text.length, nodeText.length)
            
            const range = document.createRange()
            range.setStart(node, startOffset)
            
            if (match.end <= nodeEnd) {
              // Match ends in this same node
              range.setEnd(node, endOffset)
            } else {
              // Match spans multiple nodes - for simplicity, just select to end of this node
              range.setEnd(node, nodeText.length)
            }
            
            selection.addRange(range)
            break
          }
          
          currentPos = nodeEnd
          node = walker.nextNode()
        }
      }
    }
    
    setCurrentMatch(matchIndex + 1)
  }, [editor, matches])

  const handleFindNext = useCallback(() => {
    if (matches.length === 0) return
    
    const nextIndex = currentMatch >= matches.length ? 0 : currentMatch
    selectMatch(nextIndex)
  }, [matches, currentMatch, selectMatch])

  const handleFindPrev = useCallback(() => {
    if (matches.length === 0) return
    
    const prevIndex = currentMatch <= 1 ? matches.length - 1 : currentMatch - 2
    selectMatch(prevIndex)
  }, [matches, currentMatch, selectMatch])

  const handleReplace = useCallback(() => {
    if (!editor || !findText || matches.length === 0) return
    
    const selection = window.getSelection()
    if (!selection || selection.toString() === '') {
      // If no selection, find first match
      selectMatch(0)
      return
    }

    const selectedText = selection.toString()

    // Check if selection matches the search pattern
    let isMatch = false
    if (useRegex) {
      try {
        const testRegex = new RegExp(`^${findText}$`, caseSensitive ? '' : 'i')
        isMatch = testRegex.test(selectedText)
      } catch {
        isMatch = false
      }
    } else {
      const compareA = caseSensitive ? selectedText : selectedText.toLowerCase()
      const compareB = caseSensitive ? findText : findText.toLowerCase()
      isMatch = compareA === compareB
    }

    if (isMatch) {
      // Replace the selection using Tiptap API
      const replacementText = useRegex 
        ? selectedText.replace(new RegExp(findText, caseSensitive ? '' : 'i'), replaceText)
        : replaceText
      
      // Delete selection and insert new text
      editor.chain().focus().deleteSelection().insertContent(replacementText).run()
      
      // Re-find matches and move to next
      setTimeout(() => {
        findAllMatches()
        // Try to find next match
        selectMatch(Math.max(0, currentMatch - 1))
      }, 100)
    } else {
      // Selection doesn't match, find next match
      handleFindNext()
    }
  }, [editor, findText, replaceText, useRegex, caseSensitive, matches, currentMatch, selectMatch, handleFindNext, findAllMatches])

  const handleReplaceAll = useCallback(() => {
    if (!editor || !findText) return

    const regex = getRegex()
    if (!regex) return

    const html = editor.getHTML()
    let count = 0
    let newHtml = html

    // Check if the pattern might span HTML tags (e.g., contains link patterns)
    // If so, try to replace in the full HTML first
    if (useRegex) {
      // For regex mode, first try replacing in full HTML
      const fullMatches = html.match(regex)
      if (fullMatches && fullMatches.length > 0) {
        count = fullMatches.length
        newHtml = html.replace(regex, replaceText)
      }
    }

    // If no matches found in full HTML or not regex mode, try text-only replacement
    if (count === 0) {
      // Split by HTML tags and only replace in text content
      const parts = html.split(/(<[^>]+>)/g)
      newHtml = parts.map(part => {
        if (part.startsWith('<') && part.endsWith('>')) {
          // This is an HTML tag, don't modify
          return part
        }
        // This is text content, replace
        const partMatches = part.match(regex)
        if (partMatches) count += partMatches.length
        return part.replace(regex, replaceText)
      }).join('')
    }

    if (count > 0) {
      editor.commands.setContent(newHtml)
      setMatchCount(0)
      setCurrentMatch(0)
      setMatches([])
      alert(`${count}件を置換しました`)
    } else {
      alert('一致するテキストが見つかりませんでした')
    }
  }, [editor, findText, replaceText, useRegex, getRegex])

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

  // Stop propagation to prevent interfering with editor focus
  const handlePanelClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  return (
    <div className="find-replace-panel" onClick={handlePanelClick}>
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
            setCurrentMatch(0)
          }}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <button type="button" onClick={handleFindPrev} title="前を検索 (Shift+Enter)" disabled={!findText || matchCount === 0}>◀</button>
        <button type="button" onClick={handleFindNext} title="次を検索 (Enter)" disabled={!findText || matchCount === 0}>▶</button>
        <span className="match-count">{matchCount > 0 ? `${currentMatch}/${matchCount}` : findText ? '0' : ''}</span>
      </div>
      
      <div className="find-replace-row">
        <input
          type="text"
          placeholder="置換..."
          value={replaceText}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setReplaceText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button type="button" onClick={handleReplace} title="置換" disabled={!findText || matchCount === 0}>置換</button>
        <button type="button" onClick={handleReplaceAll} title="すべて置換" disabled={!findText || matchCount === 0}>全置換</button>
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
