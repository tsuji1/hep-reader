"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addBook = addBook;
exports.getAllBooks = getAllBooks;
exports.getBook = getBook;
exports.deleteBook = deleteBook;
exports.updateBook = updateBook;
exports.addBookmark = addBookmark;
exports.getBookmarks = getBookmarks;
exports.deleteBookmark = deleteBookmark;
exports.saveProgress = saveProgress;
exports.getProgress = getProgress;
exports.addClip = addClip;
exports.getClips = getClips;
exports.getClip = getClip;
exports.deleteClip = deleteClip;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const uuid_1 = require("uuid");
const dbPath = path_1.default.join(__dirname, '../data/epub-viewer.db');
// Ensure data directory exists
const dataDir = path_1.default.dirname(dbPath);
if (!fs_1.default.existsSync(dataDir)) {
    fs_1.default.mkdirSync(dataDir, { recursive: true });
}
const db = new better_sqlite3_1.default(dbPath);
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
}
catch (e) {
    // Column already exists
}
// Migration: Add book_type column if not exists (epub, pdf)
try {
    db.exec(`ALTER TABLE books ADD COLUMN book_type TEXT DEFAULT 'epub'`);
}
catch (e) {
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
}
catch (e) {
    // Columns already exist
}
// Books
function addBook(id, title, originalFilename, totalPages, bookType = 'epub') {
    const stmt = db.prepare(`
    INSERT INTO books (id, title, original_filename, total_pages, book_type)
    VALUES (?, ?, ?, ?, ?)
  `);
    stmt.run(id, title, originalFilename, totalPages, bookType);
    return { id, title, originalFilename, totalPages, bookType };
}
function getAllBooks() {
    const stmt = db.prepare(`
    SELECT b.*, rp.current_page 
    FROM books b
    LEFT JOIN reading_progress rp ON b.id = rp.book_id
    ORDER BY b.updated_at DESC
  `);
    return stmt.all();
}
function getBook(id) {
    const stmt = db.prepare(`
    SELECT b.*, rp.current_page
    FROM books b
    LEFT JOIN reading_progress rp ON b.id = rp.book_id
    WHERE b.id = ?
  `);
    return stmt.get(id);
}
function deleteBook(id) {
    const stmt = db.prepare('DELETE FROM books WHERE id = ?');
    stmt.run(id);
}
function updateBook(id, { title, language }) {
    const updates = [];
    const values = [];
    if (title !== undefined) {
        updates.push('title = ?');
        values.push(title);
    }
    if (language !== undefined) {
        updates.push('language = ?');
        values.push(language);
    }
    if (updates.length === 0)
        return null;
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    const stmt = db.prepare(`UPDATE books SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(...values);
    return getBook(id) || null;
}
// Bookmarks
function addBookmark(bookId, pageNum, note = '') {
    const id = (0, uuid_1.v4)();
    const stmt = db.prepare(`
    INSERT INTO bookmarks (id, book_id, page_num, note)
    VALUES (?, ?, ?, ?)
  `);
    stmt.run(id, bookId, pageNum, note);
    return { id, bookId, pageNum, note };
}
function getBookmarks(bookId) {
    const stmt = db.prepare(`
    SELECT * FROM bookmarks WHERE book_id = ? ORDER BY page_num
  `);
    return stmt.all(bookId);
}
function deleteBookmark(id) {
    const stmt = db.prepare('DELETE FROM bookmarks WHERE id = ?');
    stmt.run(id);
}
// Reading Progress
function saveProgress(bookId, currentPage) {
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
function getProgress(bookId) {
    const stmt = db.prepare('SELECT * FROM reading_progress WHERE book_id = ?');
    return stmt.get(bookId);
}
// Clips (screenshot captures)
function addClip(bookId, pageNum, imageData, note = '', position = null) {
    const id = (0, uuid_1.v4)();
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
function getClips(bookId) {
    const stmt = db.prepare(`
    SELECT id, book_id, page_num, image_data, note, x_ratio, y_ratio, width_ratio, height_ratio, created_at FROM clips 
    WHERE book_id = ? ORDER BY created_at DESC
  `);
    return stmt.all(bookId);
}
function getClip(id) {
    const stmt = db.prepare('SELECT * FROM clips WHERE id = ?');
    return stmt.get(id);
}
function deleteClip(id) {
    const stmt = db.prepare('DELETE FROM clips WHERE id = ?');
    stmt.run(id);
}
// Default export for backward compatibility
exports.default = {
    addBook,
    getAllBooks,
    getBook,
    deleteBook,
    updateBook,
    addBookmark,
    getBookmarks,
    deleteBookmark,
    saveProgress,
    getProgress,
    addClip,
    getClips,
    getClip,
    deleteClip
};
//# sourceMappingURL=database.js.map