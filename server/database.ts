import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Book, BookInput, Bookmark, Clip, ClipPosition, ReadingProgress } from './types';

// ルートディレクトリ（コンパイル後は server/dist/ にあるため2階層上）
const ROOT_DIR = path.join(__dirname, '../..');
const dbPath = path.join(ROOT_DIR, 'data/epub-viewer.db');

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// Initialize tables
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

  CREATE INDEX IF NOT EXISTS idx_bookmarks_book_id ON bookmarks(book_id);
`);

// Migration: Add language column if not exists
try {
  db.exec(`ALTER TABLE books ADD COLUMN language TEXT DEFAULT 'en'`);
} catch (e) {
  // Column already exists
}

// Migration: Add book_type column if not exists (epub, pdf)
try {
  db.exec(`ALTER TABLE books ADD COLUMN book_type TEXT DEFAULT 'epub'`);
} catch (e) {
  // Column already exists
}

// Create clips table for screenshot captures
db.exec(`
  CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    page_num INTEGER NOT NULL,
    image_data TEXT NOT NULL,
    note TEXT,
    x_ratio REAL,
    y_ratio REAL,
    width_ratio REAL,
    height_ratio REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_clips_book_id ON clips(book_id);
`);

// Migration: Add position columns to clips table
try {
  db.exec(`ALTER TABLE clips ADD COLUMN x_ratio REAL`);
  db.exec(`ALTER TABLE clips ADD COLUMN y_ratio REAL`);
  db.exec(`ALTER TABLE clips ADD COLUMN width_ratio REAL`);
  db.exec(`ALTER TABLE clips ADD COLUMN height_ratio REAL`);
} catch (e) {
  // Columns already exist
}

// Migration: Add source_url column for website bookmarks
try {
  db.exec(`ALTER TABLE books ADD COLUMN source_url TEXT`);
} catch (e) {
  // Column already exists
}

// Migration: Add pdf_total_pages column for accurate PDF progress tracking
try {
  db.exec(`ALTER TABLE books ADD COLUMN pdf_total_pages INTEGER`);
} catch (e) {
  // Column already exists
}

// Migration: Add ai_context column for book-specific AI context
try {
  db.exec(`ALTER TABLE books ADD COLUMN ai_context TEXT`);
} catch (e) {
  // Column already exists
}

// Tags table
db.exec(`
  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#667eea'
  );
  
  CREATE TABLE IF NOT EXISTS book_tags (
    book_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (book_id, tag_id),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );
  
  CREATE INDEX IF NOT EXISTS idx_book_tags_book ON book_tags(book_id);
  CREATE INDEX IF NOT EXISTS idx_book_tags_tag ON book_tags(tag_id);
`);

// Initialize default "積読" tag
try {
  const existingTag = db.prepare('SELECT id FROM tags WHERE name = ?').get('積読');
  if (!existingTag) {
    const { v4: uuidv4Init } = require('uuid');
    db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)').run(uuidv4Init(), '積読', '#f59e0b');
  }
} catch (e) {
  // Tag already exists
}

// AI Settings table
db.exec(`
  CREATE TABLE IF NOT EXISTS ai_settings (
    provider TEXT PRIMARY KEY,
    api_key TEXT NOT NULL,
    model TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Notes table (差し込みエディタ用)
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    page_num INTEGER NOT NULL,
    content TEXT DEFAULT '',
    position INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_notes_book_id ON notes(book_id);
  CREATE INDEX IF NOT EXISTS idx_notes_page ON notes(book_id, page_num);
`);

// Books
export function addBook(
  id: string,
  title: string,
  originalFilename: string,
  totalPages: number,
  bookType: 'epub' | 'pdf' | 'markdown' = 'epub'
): { id: string; title: string; originalFilename: string; totalPages: number; bookType: string } {
  const stmt = db.prepare(`
    INSERT INTO books (id, title, original_filename, total_pages, book_type)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, title, originalFilename, totalPages, bookType);
  return { id, title, originalFilename, totalPages, bookType };
}

export function addWebsiteBook(
  id: string,
  title: string,
  sourceUrl: string,
  totalPages: number
): { id: string; title: string; sourceUrl: string; totalPages: number; bookType: string } {
  const stmt = db.prepare(`
    INSERT INTO books (id, title, source_url, total_pages, book_type)
    VALUES (?, ?, ?, ?, 'website')
  `);
  stmt.run(id, title, sourceUrl, totalPages);
  return { id, title, sourceUrl, totalPages, bookType: 'website' };
}

export function getAllBooks(): Book[] {
  const stmt = db.prepare(`
    SELECT b.*, rp.current_page 
    FROM books b
    LEFT JOIN reading_progress rp ON b.id = rp.book_id
    ORDER BY b.updated_at DESC
  `);
  return stmt.all() as Book[];
}

export function getBook(id: string): Book | undefined {
  const stmt = db.prepare(`
    SELECT b.*, rp.current_page
    FROM books b
    LEFT JOIN reading_progress rp ON b.id = rp.book_id
    WHERE b.id = ?
  `);
  return stmt.get(id) as Book | undefined;
}

export function deleteBook(id: string): void {
  const stmt = db.prepare('DELETE FROM books WHERE id = ?');
  stmt.run(id);
}

export function updateBook(id: string, { title, language, ai_context }: BookInput): Book | null {
  const updates: string[] = [];
  const values: (string | undefined)[] = [];

  if (title !== undefined) {
    updates.push('title = ?');
    values.push(title);
  }
  if (language !== undefined) {
    updates.push('language = ?');
    values.push(language);
  }
  if (ai_context !== undefined) {
    updates.push('ai_context = ?');
    values.push(ai_context);
  }

  if (updates.length === 0) return null;

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  const stmt = db.prepare(`UPDATE books SET ${updates.join(', ')} WHERE id = ?`);
  stmt.run(...values);
  return getBook(id) || null;
}

// Bookmarks
export function addBookmark(
  bookId: string,
  pageNum: number,
  note: string = ''
): { id: string; bookId: string; pageNum: number; note: string } {
  const id = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO bookmarks (id, book_id, page_num, note)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(id, bookId, pageNum, note);
  return { id, bookId, pageNum, note };
}

export function getBookmarks(bookId: string): Bookmark[] {
  const stmt = db.prepare(`
    SELECT * FROM bookmarks WHERE book_id = ? ORDER BY page_num
  `);
  return stmt.all(bookId) as Bookmark[];
}

export function deleteBookmark(id: string): void {
  const stmt = db.prepare('DELETE FROM bookmarks WHERE id = ?');
  stmt.run(id);
}

// Reading Progress
export function saveProgress(bookId: string, currentPage: number): void {
  const stmt = db.prepare(`
    INSERT INTO reading_progress (book_id, current_page, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(book_id) DO UPDATE SET
      current_page = excluded.current_page,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(bookId, currentPage);

  // Also update book's updated_at
  const updateBookStmt = db.prepare(`
    UPDATE books SET updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `);
  updateBookStmt.run(bookId);
}

export function getProgress(bookId: string): ReadingProgress | undefined {
  const stmt = db.prepare('SELECT * FROM reading_progress WHERE book_id = ?');
  return stmt.get(bookId) as ReadingProgress | undefined;
}

// Clips (screenshot captures)
export function addClip(
  bookId: string,
  pageNum: number,
  imageData: string,
  note: string = '',
  position: ClipPosition | null = null
): Clip {
  const id = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO clips (id, book_id, page_num, image_data, note, x_ratio, y_ratio, width_ratio, height_ratio)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const xRatio = position?.xRatio ?? null;
  const yRatio = position?.yRatio ?? null;
  const widthRatio = position?.widthRatio ?? null;
  const heightRatio = position?.heightRatio ?? null;
  stmt.run(id, bookId, pageNum, imageData, note, xRatio, yRatio, widthRatio, heightRatio);
  return {
    id,
    book_id: bookId,
    page_num: pageNum,
    image_data: imageData,
    note,
    x_ratio: xRatio,
    y_ratio: yRatio,
    width_ratio: widthRatio,
    height_ratio: heightRatio,
    created_at: new Date().toISOString()
  };
}

export function getClips(bookId: string): Clip[] {
  const stmt = db.prepare(`
    SELECT id, book_id, page_num, image_data, note, x_ratio, y_ratio, width_ratio, height_ratio, created_at FROM clips 
    WHERE book_id = ? ORDER BY created_at DESC
  `);
  return stmt.all(bookId) as Clip[];
}

export function getClip(id: string): Clip | undefined {
  const stmt = db.prepare('SELECT * FROM clips WHERE id = ?');
  return stmt.get(id) as Clip | undefined;
}

export function deleteClip(id: string): void {
  const stmt = db.prepare('DELETE FROM clips WHERE id = ?');
  stmt.run(id);
}

// Update PDF total pages (actual page count from PDF.js)
export function updatePdfTotalPages(bookId: string, pdfTotalPages: number): void {
  const stmt = db.prepare(`
    UPDATE books SET pdf_total_pages = ? WHERE id = ?
  `);
  stmt.run(pdfTotalPages, bookId);
}

// Tags
export interface TagRecord {
  id: string;
  name: string;
  color: string;
}

export function getAllTags(): TagRecord[] {
  const stmt = db.prepare('SELECT * FROM tags ORDER BY name');
  return stmt.all() as TagRecord[];
}

export function createTag(name: string, color: string = '#667eea'): TagRecord {
  const id = uuidv4();
  const stmt = db.prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)');
  stmt.run(id, name, color);
  return { id, name, color };
}

export function deleteTag(id: string): void {
  const stmt = db.prepare('DELETE FROM tags WHERE id = ?');
  stmt.run(id);
}

export function getBookTags(bookId: string): TagRecord[] {
  const stmt = db.prepare(`
    SELECT t.* FROM tags t
    JOIN book_tags bt ON t.id = bt.tag_id
    WHERE bt.book_id = ?
    ORDER BY t.name
  `);
  return stmt.all(bookId) as TagRecord[];
}

export function addTagToBook(bookId: string, tagId: string): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO book_tags (book_id, tag_id) VALUES (?, ?)
  `);
  stmt.run(bookId, tagId);
}

export function removeTagFromBook(bookId: string, tagId: string): void {
  const stmt = db.prepare('DELETE FROM book_tags WHERE book_id = ? AND tag_id = ?');
  stmt.run(bookId, tagId);
}

// AI Settings
export interface AiSetting {
  provider: string;
  api_key: string;
  model: string | null;
}

export function getAiSettings(): AiSetting[] {
  const stmt = db.prepare('SELECT provider, api_key, model FROM ai_settings');
  return stmt.all() as AiSetting[];
}

export function getAiSetting(provider: string): AiSetting | undefined {
  const stmt = db.prepare('SELECT provider, api_key, model FROM ai_settings WHERE provider = ?');
  return stmt.get(provider) as AiSetting | undefined;
}

export function saveAiSetting(provider: string, apiKey: string, model: string | null = null): { provider: string; model: string | null } {
  const stmt = db.prepare(`
    INSERT INTO ai_settings (provider, api_key, model, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(provider) DO UPDATE SET
      api_key = excluded.api_key,
      model = excluded.model,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(provider, apiKey, model);
  return { provider, model };
}

export function deleteAiSetting(provider: string): void {
  const stmt = db.prepare('DELETE FROM ai_settings WHERE provider = ?');
  stmt.run(provider);
}

// Notes (差し込みエディタ用)
export interface NoteRecord {
  id: string;
  book_id: string;
  page_num: number;
  content: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export function getNotes(bookId: string): NoteRecord[] {
  const stmt = db.prepare(`
    SELECT * FROM notes WHERE book_id = ? ORDER BY page_num, position
  `);
  return stmt.all(bookId) as NoteRecord[];
}

export function getNote(id: string): NoteRecord | undefined {
  const stmt = db.prepare('SELECT * FROM notes WHERE id = ?');
  return stmt.get(id) as NoteRecord | undefined;
}

export function addNote(
  bookId: string,
  pageNum: number,
  content: string = '',
  position: number = 0
): NoteRecord {
  const id = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO notes (id, book_id, page_num, content, position)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, bookId, pageNum, content, position);
  return {
    id,
    book_id: bookId,
    page_num: pageNum,
    content,
    position,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

export function updateNote(id: string, content: string): NoteRecord | undefined {
  const stmt = db.prepare(`
    UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `);
  stmt.run(content, id);
  return getNote(id);
}

export function deleteNote(id: string): void {
  const stmt = db.prepare('DELETE FROM notes WHERE id = ?');
  stmt.run(id);
}

// Default export for backward compatibility
export default {
  addBook,
  addWebsiteBook,
  getAllBooks,
  getBook,
  deleteBook,
  updateBook,
  updatePdfTotalPages,
  addBookmark,
  getBookmarks,
  deleteBookmark,
  saveProgress,
  getProgress,
  addClip,
  getClips,
  getClip,
  deleteClip,
  getAllTags,
  createTag,
  deleteTag,
  getBookTags,
  addTagToBook,
  removeTagFromBook,
  getAiSettings,
  getAiSetting,
  saveAiSetting,
  deleteAiSetting,
  getNotes,
  getNote,
  addNote,
  updateNote,
  deleteNote
};
