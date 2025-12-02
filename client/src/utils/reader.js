/**
 * Reader utility functions
 * テスト可能にするため、Reader.jsxから抽出した純粋関数
 */

/**
 * EPUB内の画像パスをAPI経由のパスに変換
 * @param {string} content - HTMLコンテンツ
 * @param {string} bookId - 書籍ID
 * @returns {string} 変換後のHTMLコンテンツ
 */
export function fixImagePaths(content, bookId) {
  return content
    .replace(/src="\/home\/[^"]*\/media\//g, `src="/api/books/${bookId}/media/`)
    .replace(/src="media\//g, `src="/api/books/${bookId}/media/`)
    .replace(/src="\.\/media\//g, `src="/api/books/${bookId}/media/`)
}

/**
 * max-widthを100%に変換（リーダー用）
 * @param {string} content - HTMLコンテンツ
 * @returns {string} 変換後のHTMLコンテンツ
 */
export function fixMaxWidth(content) {
  return content.replace(/max-width:\s*800px/g, 'max-width: 100%')
}

/**
 * コンテンツを整形（画像パス + max-width）
 * @param {string} content - HTMLコンテンツ
 * @param {string} bookId - 書籍ID
 * @returns {string} 変換後のHTMLコンテンツ
 */
export function fixContent(content, bookId) {
  let result = fixImagePaths(content, bookId)
  result = fixMaxWidth(result)
  return result
}

/**
 * 書籍リストをソート
 * @param {Array} books - 書籍配列
 * @param {string} sortBy - ソートキー ('lastRead' | 'title' | 'added')
 * @returns {Array} ソート済み書籍配列
 */
export function sortBooks(books, sortBy) {
  return [...books].sort((a, b) => {
    switch (sortBy) {
      case 'title':
        return a.title.localeCompare(b.title, 'ja')
      case 'added':
        return new Date(b.created_at) - new Date(a.created_at)
      case 'lastRead':
      default:
        return new Date(b.updated_at) - new Date(a.updated_at)
    }
  })
}

/**
 * 言語コードを表示名に変換
 * @param {string} langCode - 言語コード (en, ja, etc.)
 * @returns {string} 表示名
 */
export function getLanguageDisplayName(langCode) {
  const langMap = {
    'ja': '日本語',
    'en': '英語',
    'zh': '中国語',
    'ko': '韓国語',
    'de': 'ドイツ語',
    'fr': 'フランス語',
    'es': 'スペイン語'
  }
  return langMap[langCode] || langCode || '英語'
}
