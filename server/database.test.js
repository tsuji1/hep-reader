/**
 * Database Unit Tests
 * t-wada TDD style: Red → Green → Refactor
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// テスト用のDB操作モジュール（本番DBと分離）
function createTestDB(dbPath) {
  const db = new Database(dbPath)
  
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

    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      page_num INTEGER NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      book_id TEXT PRIMARY KEY,
      current_page INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );
  `)
  
  return {
    db,
    
    addBook(id, title, originalFilename, totalPages) {
      const stmt = db.prepare(`
        INSERT INTO books (id, title, original_filename, total_pages)
        VALUES (?, ?, ?, ?)
      `)
      stmt.run(id, title, originalFilename, totalPages)
      return { id, title, originalFilename, totalPages }
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

    getAllBooks() {
      const stmt = db.prepare(`
        SELECT b.*, rp.current_page 
        FROM books b
        LEFT JOIN reading_progress rp ON b.id = rp.book_id
        ORDER BY b.updated_at DESC
      `)
      return stmt.all()
    },

    deleteBook(id) {
      const stmt = db.prepare('DELETE FROM books WHERE id = ?')
      stmt.run(id)
    },

    updateBook(id, { title, language }) {
      const updates = []
      const values = []
      
      if (title !== undefined) {
        updates.push('title = ?')
        values.push(title)
      }
      if (language !== undefined) {
        updates.push('language = ?')
        values.push(language)
      }
      
      if (updates.length === 0) return null
      
      updates.push('updated_at = CURRENT_TIMESTAMP')
      values.push(id)
      
      const stmt = db.prepare(`UPDATE books SET ${updates.join(', ')} WHERE id = ?`)
      stmt.run(...values)
      return this.getBook(id)
    },

    addBookmark(bookId, pageNum, note = '') {
      const id = `bm-${Date.now()}`
      const stmt = db.prepare(`
        INSERT INTO bookmarks (id, book_id, page_num, note)
        VALUES (?, ?, ?, ?)
      `)
      stmt.run(id, bookId, pageNum, note)
      return { id, bookId, pageNum, note }
    },

    getBookmarks(bookId) {
      const stmt = db.prepare(`
        SELECT * FROM bookmarks WHERE book_id = ? ORDER BY page_num
      `)
      return stmt.all(bookId)
    },

    deleteBookmark(id) {
      const stmt = db.prepare('DELETE FROM bookmarks WHERE id = ?')
      stmt.run(id)
    },

    saveProgress(bookId, currentPage) {
      const stmt = db.prepare(`
        INSERT INTO reading_progress (book_id, current_page, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(book_id) DO UPDATE SET
          current_page = excluded.current_page,
          updated_at = CURRENT_TIMESTAMP
      `)
      stmt.run(bookId, currentPage)
    },

    getProgress(bookId) {
      const stmt = db.prepare('SELECT * FROM reading_progress WHERE book_id = ?')
      return stmt.get(bookId)
    },

    close() {
      db.close()
    }
  }
}

describe('Database', () => {
  const testDbPath = path.join(__dirname, '../data/test-epub-viewer.db')
  let testDB

  beforeEach(() => {
    // テストDBを新規作成
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath)
    }
    const dataDir = path.dirname(testDbPath)
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
    testDB = createTestDB(testDbPath)
  })

  afterEach(() => {
    // クリーンアップ
    testDB.close()
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath)
    }
  })

  describe('Books CRUD', () => {
    it('should add a new book', () => {
      const result = testDB.addBook('book-1', 'Test Book', 'test.epub', 10)
      
      expect(result.id).toBe('book-1')
      expect(result.title).toBe('Test Book')
      expect(result.totalPages).toBe(10)
    })

    it('should get a book by id', () => {
      testDB.addBook('book-1', 'Test Book', 'test.epub', 10)
      
      const book = testDB.getBook('book-1')
      
      expect(book).toBeDefined()
      expect(book.id).toBe('book-1')
      expect(book.title).toBe('Test Book')
      expect(book.language).toBe('en') // default
    })

    it('should return undefined for non-existent book', () => {
      const book = testDB.getBook('non-existent')
      
      expect(book).toBeUndefined()
    })

    it('should get all books', () => {
      testDB.addBook('book-1', 'Book One', 'one.epub', 5)
      testDB.addBook('book-2', 'Book Two', 'two.epub', 15)
      
      const books = testDB.getAllBooks()
      
      expect(books).toHaveLength(2)
    })

    it('should delete a book', () => {
      testDB.addBook('book-1', 'Test Book', 'test.epub', 10)
      
      testDB.deleteBook('book-1')
      const book = testDB.getBook('book-1')
      
      expect(book).toBeUndefined()
    })

    it('should update book title', () => {
      testDB.addBook('book-1', 'Old Title', 'test.epub', 10)
      
      const updated = testDB.updateBook('book-1', { title: 'New Title' })
      
      expect(updated.title).toBe('New Title')
    })

    it('should update book language', () => {
      testDB.addBook('book-1', 'Test Book', 'test.epub', 10)
      
      const updated = testDB.updateBook('book-1', { language: 'ja' })
      
      expect(updated.language).toBe('ja')
    })
  })

  describe('Bookmarks', () => {
    beforeEach(() => {
      testDB.addBook('book-1', 'Test Book', 'test.epub', 100)
    })

    it('should add a bookmark', () => {
      const bookmark = testDB.addBookmark('book-1', 42, 'Important section')
      
      expect(bookmark.bookId).toBe('book-1')
      expect(bookmark.pageNum).toBe(42)
      expect(bookmark.note).toBe('Important section')
    })

    it('should get bookmarks for a book', () => {
      testDB.addBookmark('book-1', 10, 'First')
      testDB.addBookmark('book-1', 20, 'Second')
      
      const bookmarks = testDB.getBookmarks('book-1')
      
      expect(bookmarks).toHaveLength(2)
      expect(bookmarks[0].page_num).toBe(10) // ordered by page_num
      expect(bookmarks[1].page_num).toBe(20)
    })

    it('should delete a bookmark', () => {
      const bookmark = testDB.addBookmark('book-1', 10, 'Test')
      
      testDB.deleteBookmark(bookmark.id)
      const bookmarks = testDB.getBookmarks('book-1')
      
      expect(bookmarks).toHaveLength(0)
    })

    it('should return empty array for book with no bookmarks', () => {
      const bookmarks = testDB.getBookmarks('book-1')
      
      expect(bookmarks).toEqual([])
    })
  })

  describe('Reading Progress', () => {
    beforeEach(() => {
      testDB.addBook('book-1', 'Test Book', 'test.epub', 100)
    })

    it('should save reading progress', () => {
      testDB.saveProgress('book-1', 25)
      
      const progress = testDB.getProgress('book-1')
      
      expect(progress.current_page).toBe(25)
    })

    it('should update existing progress', () => {
      testDB.saveProgress('book-1', 10)
      testDB.saveProgress('book-1', 50)
      
      const progress = testDB.getProgress('book-1')
      
      expect(progress.current_page).toBe(50)
    })

    it('should return undefined for book with no progress', () => {
      const progress = testDB.getProgress('book-1')
      
      expect(progress).toBeUndefined()
    })

    it('should include progress when getting book', () => {
      testDB.saveProgress('book-1', 30)
      
      const book = testDB.getBook('book-1')
      
      expect(book.current_page).toBe(30)
    })
  })
})
