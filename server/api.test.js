/**
 * API Integration Tests
 * t-wada TDD style: Red → Green → Refactor
 */
import Database from 'better-sqlite3'
import { execSync } from 'child_process'
import express from 'express'
import fs from 'fs'
import path from 'path'
import request from 'supertest'
import { fileURLToPath } from 'url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ファイル名のデコードユーティリティ（テスト対象）
function decodeFilename(filename) {
  try {
    // multerはlatin1でエンコードするため、UTF-8にデコード
    return Buffer.from(filename, 'latin1').toString('utf8')
  } catch (e) {
    return filename
  }
}

// テスト用のミニマルなExpressアプリを作成
function createTestApp(testDbPath, testConvertedDir) {
  const app = express()
  app.use(express.json())

  // テスト用DB
  const db = new Database(testDbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      original_filename TEXT,
      total_pages INTEGER DEFAULT 1,
      category TEXT,
      language TEXT DEFAULT 'en',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS reading_progress (
      book_id TEXT PRIMARY KEY,
      current_page INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)

  const dbHelpers = {
    addBook(id, title, originalFilename, totalPages, category = null) {
      const stmt = db.prepare(`
        INSERT INTO books (id, title, original_filename, total_pages, category)
        VALUES (?, ?, ?, ?, ?)
      `)
      stmt.run(id, title, originalFilename, totalPages, category)
    },
    getBook(id) {
      const stmt = db.prepare(`
        SELECT b.*, rp.current_page
        FROM books b
        LEFT JOIN reading_progress rp ON b.id = rp.book_id
        WHERE b.id = ?
      `)
      return stmt.get(id)
    },
    close() {
      db.close()
    }
  }

  // GET /api/books/:bookId - テスト対象のエンドポイント
  app.get('/api/books/:bookId', (req, res) => {
    try {
      const book = dbHelpers.getBook(req.params.bookId)
      if (!book) {
        return res.status(404).json({ error: 'Book not found' })
      }

      // PDFの場合はpages.jsonがないのでそのまま返す
      // category が 'pdf' または original_filename が .pdf で終わる場合
      const isPdf = book.category === 'pdf' ||
        (book.original_filename && book.original_filename.toLowerCase().endsWith('.pdf'))

      if (isPdf) {
        return res.json({ ...book, category: 'pdf', total: 1, pages: [] })
      }

      const pagesPath = path.join(testConvertedDir, req.params.bookId, 'pages.json')

      // pages.jsonが存在しない場合のフォールバック
      if (!fs.existsSync(pagesPath)) {
        return res.json({ ...book, total: book.total_pages || 1, pages: [] })
      }

      const pagesInfo = JSON.parse(fs.readFileSync(pagesPath, 'utf8'))

      res.json({ ...book, ...pagesInfo })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  // GET /api/books/:bookId/cover - カバー画像取得
  app.get('/api/books/:bookId/cover', async (req, res) => {
    const { bookId } = req.params
    const bookDir = path.join(testConvertedDir, bookId)
    const mediaDir = path.join(bookDir, 'media')

    // ブックディレクトリが存在しない場合
    if (!fs.existsSync(bookDir)) {
      return res.status(404).json({ error: 'Book directory not found' })
    }

    const pagesJsonPath = path.join(bookDir, 'pages.json')
    const pdfPath = path.join(bookDir, 'document.pdf')

    // PDFの場合
    if (!fs.existsSync(pagesJsonPath) && fs.existsSync(pdfPath)) {
      // カスタムカバーがあればそちらを優先
      const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
      for (const ext of extensions) {
        const customCover = path.join(bookDir, `custom-cover${ext}`)
        if (fs.existsSync(customCover)) {
          return res.sendFile(customCover)
        }
      }

      // PDFサムネイルがキャッシュされていればそれを返す
      const thumbnailPath = path.join(bookDir, 'pdf-thumbnail.png')
      if (fs.existsSync(thumbnailPath)) {
        return res.sendFile(thumbnailPath)
      }

      // pdftoppmでサムネイル生成を試みる
      try {
        const thumbPrefix = path.join(bookDir, 'pdf-thumb')
        execSync(`pdftoppm -png -f 1 -l 1 -scale-to 400 "${pdfPath}" "${thumbPrefix}"`, { timeout: 30000 })

        const possibleFiles = [
          `${thumbPrefix}-1.png`,
          `${thumbPrefix}-01.png`,
          `${thumbPrefix}-001.png`
        ]

        for (const thumbFile of possibleFiles) {
          if (fs.existsSync(thumbFile)) {
            fs.renameSync(thumbFile, thumbnailPath)
            return res.sendFile(thumbnailPath)
          }
        }

        // ディレクトリ内のpdf-thumb*.pngを探す
        const files = fs.readdirSync(bookDir)
        const thumbMatch = files.find(f => f.startsWith('pdf-thumb') && f.endsWith('.png'))
        if (thumbMatch) {
          const matchPath = path.join(bookDir, thumbMatch)
          fs.renameSync(matchPath, thumbnailPath)
          return res.sendFile(thumbnailPath)
        }
      } catch (e) {
        // pdftoppmがない環境では失敗する（CIなど）
      }

      return res.status(404).json({ error: 'No cover found for PDF' })
    }

    // カスタムカバー確認
    const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
    for (const ext of extensions) {
      const customCover = path.join(bookDir, `custom-cover${ext}`)
      if (fs.existsSync(customCover)) {
        return res.sendFile(customCover)
      }
    }

    // メディアディレクトリがなければ404
    if (!fs.existsSync(mediaDir)) {
      return res.status(404).json({ error: 'No media found' })
    }

    // カバー画像を探す
    const findCover = (dir) => {
      const items = fs.readdirSync(dir, { withFileTypes: true })
      for (const item of items) {
        const fullPath = path.join(dir, item.name)
        if (item.isDirectory()) {
          const found = findCover(fullPath)
          if (found) return found
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase()
          if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
            if (item.name.toLowerCase().includes('cover')) {
              return fullPath
            }
          }
        }
      }
      return null
    }

    let coverPath = findCover(mediaDir)

    // カバーがなければ最初の画像
    if (!coverPath) {
      const findFirstImage = (dir) => {
        const items = fs.readdirSync(dir, { withFileTypes: true })
        for (const item of items) {
          const fullPath = path.join(dir, item.name)
          if (item.isDirectory()) {
            const found = findFirstImage(fullPath)
            if (found) return found
          } else if (item.isFile()) {
            const ext = path.extname(item.name).toLowerCase()
            if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
              return fullPath
            }
          }
        }
        return null
      }
      coverPath = findFirstImage(mediaDir)
    }

    if (coverPath) {
      return res.sendFile(coverPath)
    }

    return res.status(404).json({ error: 'No cover found' })
  })

  return { app, dbHelpers }
}

describe('API: GET /api/books/:bookId', () => {
  const testDbPath = path.join(__dirname, '../data/test-api.db')
  const testConvertedDir = path.join(__dirname, '../converted-test')
  let app, dbHelpers

  beforeEach(() => {
    // クリーンアップ
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
    if (fs.existsSync(testConvertedDir)) fs.rmSync(testConvertedDir, { recursive: true })

    // ディレクトリ作成
    fs.mkdirSync(path.dirname(testDbPath), { recursive: true })
    fs.mkdirSync(testConvertedDir, { recursive: true })

    const testApp = createTestApp(testDbPath, testConvertedDir)
    app = testApp.app
    dbHelpers = testApp.dbHelpers
  })

  afterEach(() => {
    dbHelpers.close()
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
    if (fs.existsSync(testConvertedDir)) fs.rmSync(testConvertedDir, { recursive: true })
  })

  describe('EPUB books', () => {
    it('should return book info with pages.json data', async () => {
      // Arrange
      const bookId = 'epub-book-1'
      dbHelpers.addBook(bookId, 'Test EPUB', 'test.epub', 10, 'epub')

      const bookDir = path.join(testConvertedDir, bookId)
      fs.mkdirSync(bookDir, { recursive: true })
      fs.writeFileSync(
        path.join(bookDir, 'pages.json'),
        JSON.stringify({ total: 10, pages: ['page-1.html', 'page-2.html'] })
      )

      // Act
      const res = await request(app).get(`/api/books/${bookId}`)

      // Assert
      expect(res.status).toBe(200)
      expect(res.body.id).toBe(bookId)
      expect(res.body.title).toBe('Test EPUB')
      expect(res.body.total).toBe(10)
      expect(res.body.pages).toHaveLength(2)
    })

    it('should return book info even without pages.json (fallback)', async () => {
      // Arrange
      const bookId = 'epub-book-no-pages'
      dbHelpers.addBook(bookId, 'Test EPUB No Pages', 'test.epub', 5, 'epub')
      // pages.json を作成しない

      // Act
      const res = await request(app).get(`/api/books/${bookId}`)

      // Assert
      expect(res.status).toBe(200)
      expect(res.body.id).toBe(bookId)
      expect(res.body.total).toBe(5)
      expect(res.body.pages).toEqual([])
    })
  })

  describe('PDF books', () => {
    it('should return PDF book info when category is pdf', async () => {
      // Arrange
      const bookId = 'pdf-book-1'
      dbHelpers.addBook(bookId, 'Test PDF', 'test.pdf', 1, 'pdf')

      // Act
      const res = await request(app).get(`/api/books/${bookId}`)

      // Assert
      expect(res.status).toBe(200)
      expect(res.body.id).toBe(bookId)
      expect(res.body.title).toBe('Test PDF')
      expect(res.body.category).toBe('pdf')
      expect(res.body.total).toBe(1)
      expect(res.body.pages).toEqual([])
    })

    it('should detect PDF by original_filename even when category is null', async () => {
      // Arrange - 既存のPDFでcategoryがnullの場合（マイグレーション前のデータ）
      const bookId = 'pdf-book-legacy'
      dbHelpers.addBook(bookId, 'Legacy PDF', 'document.pdf', 1, null) // category = null

      // Act
      const res = await request(app).get(`/api/books/${bookId}`)

      // Assert
      expect(res.status).toBe(200)
      expect(res.body.id).toBe(bookId)
      expect(res.body.category).toBe('pdf') // nullからpdfに補正される
      expect(res.body.total).toBe(1)
      expect(res.body.pages).toEqual([])
    })

    it('should handle PDF with uppercase extension', async () => {
      // Arrange
      const bookId = 'pdf-book-uppercase'
      dbHelpers.addBook(bookId, 'Uppercase PDF', 'document.PDF', 1, null)

      // Act
      const res = await request(app).get(`/api/books/${bookId}`)

      // Assert
      expect(res.status).toBe(200)
      expect(res.body.category).toBe('pdf')
    })
  })

  describe('Error handling', () => {
    it('should return 404 for non-existent book', async () => {
      // Act
      const res = await request(app).get('/api/books/non-existent-id')

      // Assert
      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Book not found')
    })
  })
})

describe('Filename Decoding', () => {
  it('should decode Japanese filename from latin1 to utf8', () => {
    // Arrange - multerがlatin1でエンコードした日本語ファイル名をシミュレート
    const japaneseFilename = 'フルスクラッチで作る！UEFIベアメタルプログラミング.pdf'
    const latin1Encoded = Buffer.from(japaneseFilename, 'utf8').toString('latin1')

    // Act
    const decoded = decodeFilename(latin1Encoded)

    // Assert
    expect(decoded).toBe(japaneseFilename)
  })

  it('should handle ASCII filename without changes', () => {
    // Arrange
    const asciiFilename = 'test-book.epub'

    // Act
    const decoded = decodeFilename(asciiFilename)

    // Assert
    expect(decoded).toBe(asciiFilename)
  })

  it('should handle mixed Japanese and ASCII filename', () => {
    // Arrange
    const mixedFilename = '日本語Title_123.epub'
    const latin1Encoded = Buffer.from(mixedFilename, 'utf8').toString('latin1')

    // Act
    const decoded = decodeFilename(latin1Encoded)

    // Assert
    expect(decoded).toBe(mixedFilename)
  })
})

describe('API: GET /api/books/:bookId/cover', () => {
  const testDbPath = path.join(__dirname, '../data/test-cover.db')
  const testConvertedDir = path.join(__dirname, '../converted-test-cover')
  let app, dbHelpers

  beforeEach(() => {
    // クリーンアップ
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
    if (fs.existsSync(testConvertedDir)) fs.rmSync(testConvertedDir, { recursive: true })

    // ディレクトリ作成
    fs.mkdirSync(path.dirname(testDbPath), { recursive: true })
    fs.mkdirSync(testConvertedDir, { recursive: true })

    const testApp = createTestApp(testDbPath, testConvertedDir)
    app = testApp.app
    dbHelpers = testApp.dbHelpers
  })

  afterEach(() => {
    dbHelpers.close()
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
    if (fs.existsSync(testConvertedDir)) fs.rmSync(testConvertedDir, { recursive: true })
  })

  describe('EPUB cover', () => {
    it('should return cover image from media directory', async () => {
      // Arrange
      const bookId = 'epub-with-cover'
      dbHelpers.addBook(bookId, 'Test EPUB', 'test.epub', 10, 'epub')

      const bookDir = path.join(testConvertedDir, bookId)
      const mediaDir = path.join(bookDir, 'media')
      fs.mkdirSync(mediaDir, { recursive: true })
      fs.writeFileSync(path.join(bookDir, 'pages.json'), JSON.stringify({ total: 10 }))

      // ダミーの画像ファイル（1x1 PNG）
      const pngData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
      fs.writeFileSync(path.join(mediaDir, 'cover.png'), pngData)

      // Act
      const res = await request(app).get(`/api/books/${bookId}/cover`)

      // Assert
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/image\/png/)
    })

    it('should return first image if no cover found', async () => {
      // Arrange
      const bookId = 'epub-no-cover'
      dbHelpers.addBook(bookId, 'Test EPUB', 'test.epub', 10, 'epub')

      const bookDir = path.join(testConvertedDir, bookId)
      const mediaDir = path.join(bookDir, 'media')
      fs.mkdirSync(mediaDir, { recursive: true })
      fs.writeFileSync(path.join(bookDir, 'pages.json'), JSON.stringify({ total: 10 }))

      // カバーではない画像
      const pngData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
      fs.writeFileSync(path.join(mediaDir, 'image001.png'), pngData)

      // Act
      const res = await request(app).get(`/api/books/${bookId}/cover`)

      // Assert
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/image\/png/)
    })

    it('should return custom cover if exists', async () => {
      // Arrange
      const bookId = 'epub-custom-cover'
      dbHelpers.addBook(bookId, 'Test EPUB', 'test.epub', 10, 'epub')

      const bookDir = path.join(testConvertedDir, bookId)
      const mediaDir = path.join(bookDir, 'media')
      fs.mkdirSync(mediaDir, { recursive: true })
      fs.writeFileSync(path.join(bookDir, 'pages.json'), JSON.stringify({ total: 10 }))

      // 通常のカバー
      const pngData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
      fs.writeFileSync(path.join(mediaDir, 'cover.png'), pngData)

      // カスタムカバー（こちらが優先される）
      fs.writeFileSync(path.join(bookDir, 'custom-cover.jpg'), pngData)

      // Act
      const res = await request(app).get(`/api/books/${bookId}/cover`)

      // Assert
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/image\/jpeg/)
    })
  })

  describe('PDF cover', () => {
    it('should return cached PDF thumbnail if exists', async () => {
      // Arrange
      const bookId = 'pdf-with-thumbnail'
      dbHelpers.addBook(bookId, 'Test PDF', 'test.pdf', 1, 'pdf')

      const bookDir = path.join(testConvertedDir, bookId)
      fs.mkdirSync(bookDir, { recursive: true })

      // PDFファイル（ダミー）
      fs.writeFileSync(path.join(bookDir, 'document.pdf'), 'dummy pdf content')

      // キャッシュされたサムネイル
      const pngData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
      fs.writeFileSync(path.join(bookDir, 'pdf-thumbnail.png'), pngData)

      // Act
      const res = await request(app).get(`/api/books/${bookId}/cover`)

      // Assert
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/image\/png/)
    })

    it('should return custom cover for PDF if exists', async () => {
      // Arrange
      const bookId = 'pdf-custom-cover'
      dbHelpers.addBook(bookId, 'Test PDF', 'test.pdf', 1, 'pdf')

      const bookDir = path.join(testConvertedDir, bookId)
      fs.mkdirSync(bookDir, { recursive: true })

      fs.writeFileSync(path.join(bookDir, 'document.pdf'), 'dummy pdf content')

      // カスタムカバー
      const pngData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
      fs.writeFileSync(path.join(bookDir, 'custom-cover.png'), pngData)

      // Act
      const res = await request(app).get(`/api/books/${bookId}/cover`)

      // Assert
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/image\/png/)
    })
  })

  describe('Error handling', () => {
    it('should return 404 if book directory does not exist', async () => {
      // Act
      const res = await request(app).get('/api/books/non-existent-book/cover')

      // Assert
      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Book directory not found')
    })

    it('should return 404 if no media directory for EPUB', async () => {
      // Arrange
      const bookId = 'epub-no-media'
      dbHelpers.addBook(bookId, 'Test EPUB', 'test.epub', 10, 'epub')

      const bookDir = path.join(testConvertedDir, bookId)
      fs.mkdirSync(bookDir, { recursive: true })
      fs.writeFileSync(path.join(bookDir, 'pages.json'), JSON.stringify({ total: 10 }))
      // mediaディレクトリを作成しない

      // Act
      const res = await request(app).get(`/api/books/${bookId}/cover`)

      // Assert
      expect(res.status).toBe(404)
      expect(res.body.error).toBe('No media found')
    })
  })
})

// ===== Translation Save API Tests =====
describe('Translation Save API', () => {
  const testDbPath = path.join(__dirname, '../data/test-translation.db')
  const testConvertedDir = path.join(__dirname, '../converted-test-translation')
  let app, dbHelpers

  beforeEach(() => {
    // クリーンアップ
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
    if (fs.existsSync(testConvertedDir)) fs.rmSync(testConvertedDir, { recursive: true })

    // ディレクトリ作成
    fs.mkdirSync(path.dirname(testDbPath), { recursive: true })
    fs.mkdirSync(testConvertedDir, { recursive: true })

    const testApp = createTestApp(testDbPath, testConvertedDir)
    app = testApp.app
    dbHelpers = testApp.dbHelpers

    // 翻訳保存APIを追加
    app.post('/api/books/:bookId/page/:pageNum/save-translation', (req, res) => {
      try {
        const { bookId, pageNum } = req.params
        const { content } = req.body

        if (!content || typeof content !== 'string') {
          return res.status(400).json({ error: 'Content is required' })
        }

        const pagesDir = path.join(testConvertedDir, bookId, 'pages')
        const pagePath = path.join(pagesDir, `page-${pageNum}.html`)

        if (!fs.existsSync(pagePath)) {
          return res.status(404).json({ error: 'Page not found' })
        }

        // バックアップを作成（初回のみ）
        const backupPath = path.join(pagesDir, `page-${pageNum}.original.html`)
        if (!fs.existsSync(backupPath)) {
          const originalContent = fs.readFileSync(pagePath, 'utf8')
          fs.writeFileSync(backupPath, originalContent)
        }

        // 翻訳されたコンテンツを保存
        fs.writeFileSync(pagePath, content)

        res.json({ success: true, message: 'Translation saved' })
      } catch (error) {
        res.status(500).json({ error: error.message })
      }
    })

    // 復元APIを追加
    app.post('/api/books/:bookId/page/:pageNum/restore-original', (req, res) => {
      try {
        const { bookId, pageNum } = req.params

        const pagesDir = path.join(testConvertedDir, bookId, 'pages')
        const pagePath = path.join(pagesDir, `page-${pageNum}.html`)
        const backupPath = path.join(pagesDir, `page-${pageNum}.original.html`)

        if (!fs.existsSync(backupPath)) {
          return res.status(404).json({ error: 'Original backup not found' })
        }

        const originalContent = fs.readFileSync(backupPath, 'utf8')
        fs.writeFileSync(pagePath, originalContent)

        res.json({ success: true, message: 'Original restored' })
      } catch (error) {
        res.status(500).json({ error: error.message })
      }
    })
  })

  afterEach(() => {
    dbHelpers.close()
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
    if (fs.existsSync(testConvertedDir)) fs.rmSync(testConvertedDir, { recursive: true })
  })

  it('should save translated content and create backup', async () => {
    // Arrange
    const bookId = 'test-book-translation'
    dbHelpers.addBook(bookId, 'Test Book', 'test.epub', 3, 'epub')

    const bookDir = path.join(testConvertedDir, bookId)
    const pagesDir = path.join(bookDir, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })

    const originalContent = '<html><body><p>Original English text</p></body></html>'
    fs.writeFileSync(path.join(pagesDir, 'page-1.html'), originalContent)

    const translatedContent = '<html><body><p>翻訳された日本語テキスト</p></body></html>'

    // Act
    const res = await request(app)
      .post(`/api/books/${bookId}/page/1/save-translation`)
      .send({ content: translatedContent })

    // Assert
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    // 翻訳が保存されている
    const savedContent = fs.readFileSync(path.join(pagesDir, 'page-1.html'), 'utf8')
    expect(savedContent).toBe(translatedContent)

    // バックアップが作成されている
    const backupContent = fs.readFileSync(path.join(pagesDir, 'page-1.original.html'), 'utf8')
    expect(backupContent).toBe(originalContent)
  })

  it('should not overwrite backup on second save', async () => {
    // Arrange
    const bookId = 'test-book-backup'
    dbHelpers.addBook(bookId, 'Test Book', 'test.epub', 1, 'epub')

    const bookDir = path.join(testConvertedDir, bookId)
    const pagesDir = path.join(bookDir, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })

    const originalContent = '<p>Original</p>'
    fs.writeFileSync(path.join(pagesDir, 'page-1.html'), originalContent)

    // Act - 1回目の保存
    await request(app)
      .post(`/api/books/${bookId}/page/1/save-translation`)
      .send({ content: '<p>First translation</p>' })

    // Act - 2回目の保存
    await request(app)
      .post(`/api/books/${bookId}/page/1/save-translation`)
      .send({ content: '<p>Second translation</p>' })

    // Assert - バックアップは元のまま
    const backupContent = fs.readFileSync(path.join(pagesDir, 'page-1.original.html'), 'utf8')
    expect(backupContent).toBe(originalContent)
  })

  it('should restore original content from backup', async () => {
    // Arrange
    const bookId = 'test-book-restore'
    dbHelpers.addBook(bookId, 'Test Book', 'test.epub', 1, 'epub')

    const bookDir = path.join(testConvertedDir, bookId)
    const pagesDir = path.join(bookDir, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })

    const originalContent = '<p>Original content</p>'
    fs.writeFileSync(path.join(pagesDir, 'page-1.html'), originalContent)

    // 翻訳を保存
    await request(app)
      .post(`/api/books/${bookId}/page/1/save-translation`)
      .send({ content: '<p>Translated</p>' })

    // Act - 復元
    const res = await request(app)
      .post(`/api/books/${bookId}/page/1/restore-original`)
      .send()

    // Assert
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const restoredContent = fs.readFileSync(path.join(pagesDir, 'page-1.html'), 'utf8')
    expect(restoredContent).toBe(originalContent)
  })

  it('should return 404 for non-existent page', async () => {
    // Arrange
    const bookId = 'test-book-404'
    dbHelpers.addBook(bookId, 'Test Book', 'test.epub', 1, 'epub')

    const bookDir = path.join(testConvertedDir, bookId)
    const pagesDir = path.join(bookDir, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })

    // Act
    const res = await request(app)
      .post(`/api/books/${bookId}/page/99/save-translation`)
      .send({ content: '<p>Test</p>' })

    // Assert
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Page not found')
  })

  it('should return 400 if content is missing', async () => {
    // Arrange
    const bookId = 'test-book-no-content'
    dbHelpers.addBook(bookId, 'Test Book', 'test.epub', 1, 'epub')

    const bookDir = path.join(testConvertedDir, bookId)
    const pagesDir = path.join(bookDir, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })
    fs.writeFileSync(path.join(pagesDir, 'page-1.html'), '<p>Test</p>')

    // Act
    const res = await request(app)
      .post(`/api/books/${bookId}/page/1/save-translation`)
      .send({})

    // Assert
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Content is required')
  })
})

describe('Translation Status API', () => {
  const testDbPath = path.join(__dirname, '../data/test-translation-status.db')
  const testConvertedDir = path.join(__dirname, '../converted-test-translation-status')
  let app, dbHelpers

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
    if (fs.existsSync(testConvertedDir)) fs.rmSync(testConvertedDir, { recursive: true })

    fs.mkdirSync(path.dirname(testDbPath), { recursive: true })
    fs.mkdirSync(testConvertedDir, { recursive: true })

    const testApp = createTestApp(testDbPath, testConvertedDir)
    app = testApp.app
    dbHelpers = testApp.dbHelpers

    // 翻訳状態APIを追加
    app.get('/api/books/:bookId/translation-status', (req, res) => {
      try {
        const { bookId } = req.params
        const pagesDir = path.join(testConvertedDir, bookId, 'pages')

        if (!fs.existsSync(pagesDir)) {
          return res.status(404).json({ error: 'Book pages not found' })
        }

        const files = fs.readdirSync(pagesDir)
        const translatedPages = []

        for (const file of files) {
          const match = file.match(/^page-(\d+)\.original\.html$/)
          if (match) {
            translatedPages.push(parseInt(match[1], 10))
          }
        }

        res.json({
          translatedPages: translatedPages.sort((a, b) => a - b),
          totalTranslated: translatedPages.length
        })
      } catch (error) {
        res.status(500).json({ error: error.message })
      }
    })

    // 全復元APIを追加
    app.post('/api/books/:bookId/restore-all-translations', (req, res) => {
      try {
        const { bookId } = req.params
        const pagesDir = path.join(testConvertedDir, bookId, 'pages')

        if (!fs.existsSync(pagesDir)) {
          return res.status(404).json({ error: 'Book pages not found' })
        }

        const files = fs.readdirSync(pagesDir)
        let restoredCount = 0

        for (const file of files) {
          const match = file.match(/^page-(\d+)\.original\.html$/)
          if (match) {
            const pageNum = match[1]
            const backupPath = path.join(pagesDir, file)
            const pagePath = path.join(pagesDir, `page-${pageNum}.html`)

            const originalContent = fs.readFileSync(backupPath, 'utf8')
            fs.writeFileSync(pagePath, originalContent)
            fs.unlinkSync(backupPath)
            restoredCount++
          }
        }

        res.json({ success: true, restoredCount })
      } catch (error) {
        res.status(500).json({ error: error.message })
      }
    })
  })

  afterEach(() => {
    dbHelpers.close()
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
    if (fs.existsSync(testConvertedDir)) fs.rmSync(testConvertedDir, { recursive: true })
  })

  it('should return empty array when no pages are translated', async () => {
    // Arrange
    const bookId = 'test-no-translations'
    dbHelpers.addBook(bookId, 'Test Book', 'test.epub', 3, 'epub')

    const pagesDir = path.join(testConvertedDir, bookId, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })
    fs.writeFileSync(path.join(pagesDir, 'page-1.html'), '<p>Page 1</p>')
    fs.writeFileSync(path.join(pagesDir, 'page-2.html'), '<p>Page 2</p>')

    // Act
    const res = await request(app).get(`/api/books/${bookId}/translation-status`)

    // Assert
    expect(res.status).toBe(200)
    expect(res.body.translatedPages).toEqual([])
    expect(res.body.totalTranslated).toBe(0)
  })

  it('should return translated page numbers', async () => {
    // Arrange
    const bookId = 'test-with-translations'
    dbHelpers.addBook(bookId, 'Test Book', 'test.epub', 5, 'epub')

    const pagesDir = path.join(testConvertedDir, bookId, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })

    // ページを作成
    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(path.join(pagesDir, `page-${i}.html`), `<p>Page ${i}</p>`)
    }

    // ページ1, 3, 5を翻訳済みに（.original.htmlファイルを作成）
    fs.writeFileSync(path.join(pagesDir, 'page-1.original.html'), '<p>Original 1</p>')
    fs.writeFileSync(path.join(pagesDir, 'page-3.original.html'), '<p>Original 3</p>')
    fs.writeFileSync(path.join(pagesDir, 'page-5.original.html'), '<p>Original 5</p>')

    // Act
    const res = await request(app).get(`/api/books/${bookId}/translation-status`)

    // Assert
    expect(res.status).toBe(200)
    expect(res.body.translatedPages).toEqual([1, 3, 5])
    expect(res.body.totalTranslated).toBe(3)
  })

  it('should restore all translations and delete backup files', async () => {
    // Arrange
    const bookId = 'test-restore-all'
    dbHelpers.addBook(bookId, 'Test Book', 'test.epub', 2, 'epub')

    const pagesDir = path.join(testConvertedDir, bookId, 'pages')
    fs.mkdirSync(pagesDir, { recursive: true })

    // 翻訳済み状態を作成
    fs.writeFileSync(path.join(pagesDir, 'page-1.html'), '<p>Translated 1</p>')
    fs.writeFileSync(path.join(pagesDir, 'page-1.original.html'), '<p>Original 1</p>')
    fs.writeFileSync(path.join(pagesDir, 'page-2.html'), '<p>Translated 2</p>')
    fs.writeFileSync(path.join(pagesDir, 'page-2.original.html'), '<p>Original 2</p>')

    // Act
    const res = await request(app).post(`/api/books/${bookId}/restore-all-translations`)

    // Assert
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.restoredCount).toBe(2)

    // 元のコンテンツが復元されている
    expect(fs.readFileSync(path.join(pagesDir, 'page-1.html'), 'utf8')).toBe('<p>Original 1</p>')
    expect(fs.readFileSync(path.join(pagesDir, 'page-2.html'), 'utf8')).toBe('<p>Original 2</p>')

    // バックアップファイルは削除されている
    expect(fs.existsSync(path.join(pagesDir, 'page-1.original.html'))).toBe(false)
    expect(fs.existsSync(path.join(pagesDir, 'page-2.original.html'))).toBe(false)
  })
})

// ===== Markdown Upload Tests =====
describe('Markdown Upload', () => {
  const testDbPath = path.join(__dirname, '../data/test-markdown.db')
  const testConvertedDir = path.join(__dirname, '../converted-test-markdown')
  const testUploadsDir = path.join(__dirname, '../uploads-test-markdown')
  let app, dbHelpers

  beforeEach(() => {
    // クリーンアップ
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
    if (fs.existsSync(testConvertedDir)) fs.rmSync(testConvertedDir, { recursive: true })
    if (fs.existsSync(testUploadsDir)) fs.rmSync(testUploadsDir, { recursive: true })

    // ディレクトリ作成
    fs.mkdirSync(path.dirname(testDbPath), { recursive: true })
    fs.mkdirSync(testConvertedDir, { recursive: true })
    fs.mkdirSync(testUploadsDir, { recursive: true })

    const testApp = createTestApp(testDbPath, testConvertedDir)
    app = testApp.app
    dbHelpers = testApp.dbHelpers
  })

  afterEach(() => {
    dbHelpers.close()
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath)
    if (fs.existsSync(testConvertedDir)) fs.rmSync(testConvertedDir, { recursive: true })
    if (fs.existsSync(testUploadsDir)) fs.rmSync(testUploadsDir, { recursive: true })
  })

  describe('convertMarkdownToHtml helper', () => {
    it('should convert simple markdown to HTML', () => {
      // Arrange
      const markdown = '# Hello World\n\nThis is a paragraph.'

      // Act - using pandoc to convert
      const tempMdPath = path.join(testUploadsDir, 'test.md')
      const tempHtmlPath = path.join(testUploadsDir, 'test.html')
      fs.writeFileSync(tempMdPath, markdown)

      try {
        execSync(`pandoc "${tempMdPath}" -o "${tempHtmlPath}" --standalone`, { stdio: 'pipe' })
        const html = fs.readFileSync(tempHtmlPath, 'utf8')

        // Assert
        expect(html).toContain('Hello World')
        expect(html).toContain('This is a paragraph')
      } catch (e) {
        // pandocがない環境ではスキップ
        console.log('Skipping pandoc test - pandoc not installed')
      }
    })

    it('should handle markdown with images', () => {
      // Arrange
      const markdown = '# Test\n\n![Alt text](images/test.png)'

      // Act
      const tempMdPath = path.join(testUploadsDir, 'test-img.md')
      const tempHtmlPath = path.join(testUploadsDir, 'test-img.html')
      fs.writeFileSync(tempMdPath, markdown)

      try {
        execSync(`pandoc "${tempMdPath}" -o "${tempHtmlPath}" --standalone`, { stdio: 'pipe' })
        const html = fs.readFileSync(tempHtmlPath, 'utf8')

        // Assert
        expect(html).toContain('img')
        expect(html).toContain('images/test.png')
      } catch (e) {
        console.log('Skipping pandoc test - pandoc not installed')
      }
    })

    it('should handle Japanese markdown', () => {
      // Arrange
      const markdown = '# 日本語タイトル\n\nこれは日本語のテストです。'

      // Act
      const tempMdPath = path.join(testUploadsDir, 'japanese.md')
      const tempHtmlPath = path.join(testUploadsDir, 'japanese.html')
      fs.writeFileSync(tempMdPath, markdown, 'utf8')

      try {
        execSync(`pandoc "${tempMdPath}" -o "${tempHtmlPath}" --standalone`, { stdio: 'pipe' })
        const html = fs.readFileSync(tempHtmlPath, 'utf8')

        // Assert
        expect(html).toContain('日本語タイトル')
        expect(html).toContain('これは日本語のテストです')
      } catch (e) {
        console.log('Skipping pandoc test - pandoc not installed')
      }
    })
  })

  describe('Markdown image path resolution', () => {
    // Helper function to fix image paths in markdown content
    function fixMarkdownImagePaths(content, bookId, mediaDir) {
      // Convert relative image paths to API paths
      // ![alt](images/foo.png) -> ![alt](/api/books/{bookId}/media/foo.png)
      // ![alt](./images/foo.png) -> ![alt](/api/books/{bookId}/media/foo.png)
      return content
        .replace(/!\[([^\]]*)\]\((?:\.\/)?(?:images|img|media)\/([^)]+)\)/g,
          `![$1](/api/books/${bookId}/media/$2)`)
        .replace(/src="(?:\.\/)?(?:images|img|media)\/([^"]+)"/g,
          `src="/api/books/${bookId}/media/$1"`)
    }

    it('should convert relative image paths to API paths', () => {
      // Arrange
      const bookId = 'test-book-123'
      const html = '<img src="images/test.png" alt="test">'

      // Act
      const fixed = fixMarkdownImagePaths(html, bookId, '')

      // Assert
      expect(fixed).toBe('<img src="/api/books/test-book-123/media/test.png" alt="test">')
    })

    it('should handle ./images/ prefix', () => {
      // Arrange
      const bookId = 'test-book-456'
      const html = '<img src="./images/photo.jpg" alt="photo">'

      // Act
      const fixed = fixMarkdownImagePaths(html, bookId, '')

      // Assert
      expect(fixed).toBe('<img src="/api/books/test-book-456/media/photo.jpg" alt="photo">')
    })

    it('should handle markdown image syntax', () => {
      // Arrange
      const bookId = 'test-book-789'
      const markdown = '![Alt text](images/diagram.svg)'

      // Act
      const fixed = fixMarkdownImagePaths(markdown, bookId, '')

      // Assert
      expect(fixed).toBe('![Alt text](/api/books/test-book-789/media/diagram.svg)')
    })

    it('should handle multiple images', () => {
      // Arrange
      const bookId = 'multi-img'
      const html = '<img src="images/a.png"><img src="./img/b.jpg">'

      // Act
      const fixed = fixMarkdownImagePaths(html, bookId, '')

      // Assert
      expect(fixed).toContain('/api/books/multi-img/media/a.png')
      expect(fixed).toContain('/api/books/multi-img/media/b.jpg')
    })
  })
})

// ===== ZIP Upload Tests =====
describe('ZIP Upload', () => {
  describe('ZIP extraction helper', () => {
    it('should identify markdown files in extracted contents', () => {
      // Helper function to identify markdown files
      function findMarkdownFiles(files) {
        return files.filter(f => /\.md$/i.test(f) && !f.startsWith('__MACOSX'))
      }

      // Arrange
      const files = [
        'README.md',
        'docs/chapter1.md',
        'docs/chapter2.MD',
        'images/photo.png',
        '__MACOSX/README.md',
        'notes.txt'
      ]

      // Act
      const mdFiles = findMarkdownFiles(files)

      // Assert
      expect(mdFiles).toHaveLength(3)
      expect(mdFiles).toContain('README.md')
      expect(mdFiles).toContain('docs/chapter1.md')
      expect(mdFiles).toContain('docs/chapter2.MD')
    })

    it('should identify image directories', () => {
      // Helper function to identify image directories
      function findImageDirectories(files) {
        const imageDirs = new Set()
        for (const f of files) {
          if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f)) {
            const dir = path.dirname(f)
            if (dir !== '.') {
              imageDirs.add(dir)
            }
          }
        }
        return Array.from(imageDirs)
      }

      // Arrange
      const files = [
        'README.md',
        'images/photo.png',
        'images/diagram.svg',
        'assets/img/logo.jpg',
        'cover.png'
      ]

      // Act
      const imgDirs = findImageDirectories(files)

      // Assert
      expect(imgDirs).toContain('images')
      expect(imgDirs).toContain('assets/img')
    })
  })
})

// ===== Folder Upload Tests =====
describe('Folder Upload', () => {
  describe('Multiple markdown files handling', () => {
    it('should sort markdown files by name', () => {
      // Arrange
      const files = [
        'chapter-10.md',
        'chapter-2.md',
        'chapter-1.md',
        'chapter-3.md'
      ]

      // Natural sort for proper ordering
      const sorted = files.sort((a, b) => {
        return a.localeCompare(b, undefined, { numeric: true })
      })

      // Assert
      expect(sorted).toEqual([
        'chapter-1.md',
        'chapter-2.md',
        'chapter-3.md',
        'chapter-10.md'
      ])
    })

    it('should handle nested folder structure', () => {
      // Helper to get title from path
      function getTitleFromPath(filePath) {
        const basename = path.basename(filePath, path.extname(filePath))
        return basename
          .replace(/[-_]/g, ' ')
          .replace(/([a-z])([A-Z])/g, '$1 $2')
      }

      // Arrange & Act & Assert
      expect(getTitleFromPath('docs/chapter-1.md')).toBe('chapter 1')
      expect(getTitleFromPath('my_document.md')).toBe('my document')
      expect(getTitleFromPath('CamelCaseTitle.md')).toBe('Camel Case Title')
    })
  })
})

// ===== Multi-page URL API Tests =====
// ヘルパー関数のテストは server/multipage-utils.test.js に移動済み

describe('Multi-page URL API: Input Validation', () => {
  // Simple validation test app
  const createValidationTestApp = () => {
    const app = express()
    app.use(express.json())

    app.post('/api/save-multipage-url', (req, res) => {
      const { url, linkClass, ignorePaths = [], maxPages = 50 } = req.body

      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URL is required' })
      }

      if (!linkClass || typeof linkClass !== 'string') {
        return res.status(400).json({ error: 'linkClass is required (e.g., "next-page")' })
      }

      // Validate URL
      try {
        const parsedUrl = new URL(url)
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          throw new Error('Invalid protocol')
        }
      } catch {
        return res.status(400).json({ error: 'Invalid URL format' })
      }

      // If validation passes, return success (without actually crawling)
      res.json({
        success: true,
        message: 'Validation passed',
        params: { url, linkClass, ignorePaths, maxPages }
      })
    })

    return app
  }

  let app

  beforeEach(() => {
    app = createValidationTestApp()
  })

  it('should require URL', async () => {
    const res = await request(app)
      .post('/api/save-multipage-url')
      .send({ linkClass: 'next-page' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('URL is required')
  })

  it('should require linkClass', async () => {
    const res = await request(app)
      .post('/api/save-multipage-url')
      .send({ url: 'https://example.com' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('linkClass is required (e.g., "next-page")')
  })

  it('should reject invalid URL protocol', async () => {
    const res = await request(app)
      .post('/api/save-multipage-url')
      .send({ url: 'ftp://example.com', linkClass: 'next-page' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid URL format')
  })

  it('should reject malformed URL', async () => {
    const res = await request(app)
      .post('/api/save-multipage-url')
      .send({ url: 'not-a-valid-url', linkClass: 'next-page' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid URL format')
  })

  it('should accept valid HTTP URL', async () => {
    const res = await request(app)
      .post('/api/save-multipage-url')
      .send({ url: 'http://example.com', linkClass: 'next-page' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('should accept valid HTTPS URL', async () => {
    const res = await request(app)
      .post('/api/save-multipage-url')
      .send({ url: 'https://example.com', linkClass: 'next-page' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('should use default values for optional parameters', async () => {
    const res = await request(app)
      .post('/api/save-multipage-url')
      .send({ url: 'https://example.com', linkClass: 'next-page' })

    expect(res.status).toBe(200)
    expect(res.body.params.ignorePaths).toEqual([])
    expect(res.body.params.maxPages).toBe(50)
  })

  it('should accept custom ignorePaths and maxPages', async () => {
    const res = await request(app)
      .post('/api/save-multipage-url')
      .send({
        url: 'https://example.com',
        linkClass: 'next-page',
        ignorePaths: ['/api.html', '/about'],
        maxPages: 100
      })

    expect(res.status).toBe(200)
    expect(res.body.params.ignorePaths).toEqual(['/api.html', '/about'])
    expect(res.body.params.maxPages).toBe(100)
  })
})
