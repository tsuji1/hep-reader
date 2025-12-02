/**
 * API Integration Tests
 * t-wada TDD style: Red → Green → Refactor
 */
import Database from 'better-sqlite3'
import express from 'express'
import fs from 'fs'
import path from 'path'
import request from 'supertest'
import { fileURLToPath } from 'url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
