import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { Mathematics } from '@tiptap/extension-mathematics'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import 'katex/dist/katex.min.css'
import { useCallback, useEffect } from 'react'
import './editor.css'

interface TiptapEditorProps {
  content: string
  onChange?: (html: string) => void
  editable?: boolean
  placeholder?: string
  className?: string
  markdown?: boolean // Markdownとしてパースするか
}

// ツールバーボタンコンポーネント
function MenuBar({ editor }: { editor: Editor | null }) {
  if (!editor) return null

  return (
    <div className="tiptap-toolbar">
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={editor.isActive('bold') ? 'active' : ''}
        title="太字"
      >
        B
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={editor.isActive('italic') ? 'active' : ''}
        title="斜体"
      >
        I
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={editor.isActive('strike') ? 'active' : ''}
        title="取り消し線"
      >
        S
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={editor.isActive('code') ? 'active' : ''}
        title="コード"
      >
        {'</>'}
      </button>

      <span className="toolbar-divider" />

      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        className={editor.isActive('heading', { level: 1 }) ? 'active' : ''}
        title="見出し1"
      >
        H1
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={editor.isActive('heading', { level: 2 }) ? 'active' : ''}
        title="見出し2"
      >
        H2
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={editor.isActive('heading', { level: 3 }) ? 'active' : ''}
        title="見出し3"
      >
        H3
      </button>

      <span className="toolbar-divider" />

      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={editor.isActive('bulletList') ? 'active' : ''}
        title="箇条書き"
      >
        •
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={editor.isActive('orderedList') ? 'active' : ''}
        title="番号付きリスト"
      >
        1.
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={editor.isActive('blockquote') ? 'active' : ''}
        title="引用"
      >
        "
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={editor.isActive('codeBlock') ? 'active' : ''}
        title="コードブロック"
      >
        {'{ }'}
      </button>

      <span className="toolbar-divider" />

      <button
        type="button"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="水平線"
      >
        ―
      </button>
      <button
        type="button"
        onClick={() => {
          const latex = window.prompt('LaTeX数式を入力:', 'x^2 + y^2 = z^2')
          if (latex) {
            editor.chain().focus().insertInlineMath({ latex }).run()
          }
        }}
        title="数式（インライン）"
      >
        ∑
      </button>
      <button
        type="button"
        onClick={() => {
          const latex = window.prompt('LaTeX数式を入力（ブロック）:', '\\frac{a}{b}')
          if (latex) {
            editor.chain().focus().insertBlockMath({ latex }).run()
          }
        }}
        title="数式（ブロック）"
      >
        ∫
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="元に戻す"
      >
        ↩
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="やり直す"
      >
        ↪
      </button>
    </div>
  )
}

export default function TiptapEditor({
  content,
  onChange,
  editable = true,
  placeholder = 'ここに入力...',
  className = '',
  markdown = false
}: TiptapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6]
        }
      }),
      Placeholder.configure({
        placeholder
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer'
        }
      }),
      Image.configure({
        inline: true,
        allowBase64: true
      }),
      Mathematics.configure({
        katexOptions: {
          throwOnError: false
        }
      }),
      Markdown
    ],
    content,
    // Markdownモードの場合はcontentTypeを指定
    ...(markdown && { contentType: 'markdown' as const }),
    editable,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML())
    }
  })

  // contentが外部から変更された場合に反映
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  // editable状態の変更を反映
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable)
    }
  }, [editable, editor])

  const addImage = useCallback(() => {
    const url = window.prompt('画像URLを入力:')
    if (url && editor) {
      editor.chain().focus().setImage({ src: url }).run()
    }
  }, [editor])

  const addLink = useCallback(() => {
    const url = window.prompt('リンクURLを入力:')
    if (url && editor) {
      editor.chain().focus().setLink({ href: url }).run()
    }
  }, [editor])

  return (
    <div className={`tiptap-editor ${className}`}>
      {editable && (
        <div className="tiptap-toolbar-container">
          <MenuBar editor={editor} />
          <div className="tiptap-toolbar-extra">
            <button type="button" onClick={addImage} title="画像を追加">
              🖼
            </button>
            <button type="button" onClick={addLink} title="リンクを追加">
              🔗
            </button>
          </div>
        </div>
      )}
      <EditorContent editor={editor} className="tiptap-content" />
    </div>
  )
}

// エディタインスタンスを外部から使用するためのhook
export { useEditor, type Editor }

