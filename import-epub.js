#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

// Database setup
const Database = require('better-sqlite3');
const dbPath = path.join(__dirname, 'data/epub-viewer.db');
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
`);

const convertedDir = path.join(__dirname, 'converted');
if (!fs.existsSync(convertedDir)) {
  fs.mkdirSync(convertedDir, { recursive: true });
}

// Get directory from args or use default
const targetDir = process.argv[2] || 'epub';

// Find all EPUB files
function findEpubFiles(dir) {
  const results = [];
  
  function scan(currentDir, category = '') {
    const items = fs.readdirSync(currentDir);
    
    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        // Use directory name as category
        scan(fullPath, item);
      } else if (item.endsWith('.epub')) {
        results.push({ 
          path: fullPath, 
          filename: item,
          category: category || 'uncategorized'
        });
      }
    }
  }
  
  scan(dir);
  return results;
}

// Split HTML into pages
function splitIntoPages(htmlContent, bookDir) {
  const headMatch = htmlContent.match(/<head>([\s\S]*?)<\/head>/i);
  const headContent = headMatch ? headMatch[1] : '';
  
  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : htmlContent;

  const tocMatch = bodyContent.match(/<nav[^>]*id="TOC"[^>]*>([\s\S]*?)<\/nav>/i);
  const tocContent = tocMatch ? tocMatch[0] : '';
  
  let contentWithoutToc = bodyContent.replace(/<nav[^>]*id="TOC"[^>]*>[\s\S]*?<\/nav>/i, '');

  // Split by sections
  const sectionRegex = /(<(?:section|div)[^>]*class="[^"]*level1[^"]*"[^>]*>[\s\S]*?<\/(?:section|div)>)|(<h1[^>]*>[\s\S]*?)(?=<h1|$)/gi;
  let sections = contentWithoutToc.match(sectionRegex);
  
  if (!sections || sections.length === 0) {
    const h2Regex = /<h2[^>]*>[\s\S]*?(?=<h2|$)/gi;
    sections = contentWithoutToc.match(h2Regex);
  }
  
  if (!sections || sections.length === 0) {
    sections = [contentWithoutToc];
  }

  const pagesDir = path.join(bookDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });

  fs.writeFileSync(path.join(bookDir, 'toc.html'), tocContent);
  
  const customStyles = `
    <style>
      body { 
        font-family: 'Noto Sans JP', 'Hiragino Sans', sans-serif;
        line-height: 1.8;
        max-width: 800px;
        margin: 0 auto;
        padding: 20px;
        background: #fafafa;
        color: #333;
      }
      img { max-width: 100%; height: auto; }
      pre { background: #f4f4f4; padding: 15px; overflow-x: auto; border-radius: 5px; }
      code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
      h1, h2, h3 { color: #2c3e50; }
      a { color: #3498db; }
    </style>
  `;

  const pages = sections.map((section, index) => {
    const pageHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${headContent}
  ${customStyles}
</head>
<body>
  ${section}
</body>
</html>`;
    
    const pageFile = `page-${index + 1}.html`;
    fs.writeFileSync(path.join(pagesDir, pageFile), pageHtml);
    return pageFile;
  });

  fs.writeFileSync(
    path.join(bookDir, 'pages.json'),
    JSON.stringify({ total: pages.length, pages })
  );

  return pages;
}

// Convert single EPUB
function convertEpub(epubInfo) {
  const { path: epubPath, filename, category } = epubInfo;
  
  // Check if already imported
  const existing = db.prepare('SELECT id FROM books WHERE original_filename = ?').get(filename);
  if (existing) {
    console.log(`⏭️  スキップ (既存): ${filename}`);
    return null;
  }

  const bookId = uuidv4();
  const bookDir = path.join(convertedDir, bookId);
  const mediaDir = path.join(bookDir, 'media');
  const outputHtml = path.join(bookDir, 'index.html');

  fs.mkdirSync(bookDir, { recursive: true });
  fs.mkdirSync(mediaDir, { recursive: true });

  // Generate title from filename
  const bookTitle = path.basename(filename, '.epub')
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/(\d+)e$/i, ' $1e')  // Handle edition numbers
    .replace(/(\d+)(nd|rd|th)edition/i, ' $1$2 Edition');

  // Convert with pandoc
  const pandocCmd = `pandoc "${epubPath}" --standalone --extract-media="${mediaDir}" --toc --metadata title="${bookTitle}" -o "${outputHtml}"`;
  
  try {
    execSync(pandocCmd, { stdio: 'pipe' });
  } catch (error) {
    console.error(`❌ 変換失敗: ${filename}`);
    fs.rmSync(bookDir, { recursive: true, force: true });
    return null;
  }

  // Split into pages
  const htmlContent = fs.readFileSync(outputHtml, 'utf8');
  const pages = splitIntoPages(htmlContent, bookDir);

  // Save to database
  const stmt = db.prepare(`
    INSERT INTO books (id, title, original_filename, total_pages, category)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(bookId, bookTitle, filename, pages.length, category);

  return { bookId, title: bookTitle, pages: pages.length };
}

// Main
console.log('📚 EPUB一括インポート開始\n');
console.log(`対象ディレクトリ: ${targetDir}\n`);

const epubFiles = findEpubFiles(targetDir);
console.log(`${epubFiles.length} 件のEPUBファイルを検出\n`);

let imported = 0;
let skipped = 0;
let failed = 0;

for (let i = 0; i < epubFiles.length; i++) {
  const epub = epubFiles[i];
  process.stdout.write(`[${i + 1}/${epubFiles.length}] ${epub.filename}... `);
  
  try {
    const result = convertEpub(epub);
    if (result) {
      console.log(`✅ ${result.pages}ページ`);
      imported++;
    } else {
      skipped++;
    }
  } catch (error) {
    console.log(`❌ エラー: ${error.message}`);
    failed++;
  }
}

console.log('\n📊 結果:');
console.log(`  ✅ インポート: ${imported}`);
console.log(`  ⏭️  スキップ: ${skipped}`);
console.log(`  ❌ 失敗: ${failed}`);
console.log('\n完了！ http://localhost:3002 で閲覧できます');
