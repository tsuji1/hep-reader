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
