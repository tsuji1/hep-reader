const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;

// ファイル名のデコードユーティリティ
// multerはlatin1でエンコードするため、UTF-8にデコード
function decodeFilename(filename) {
  try {
    return Buffer.from(filename, 'latin1').toString('utf8')
  } catch (e) {
    return filename
  }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/converted', express.static(path.join(__dirname, '../converted')));

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
}

// Ensure directories exist
const uploadsDir = path.join(__dirname, '../uploads');
const convertedDir = path.join(__dirname, '../converted');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(convertedDir)) fs.mkdirSync(convertedDir, { recursive: true });

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.epub' || ext === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only EPUB and PDF files are allowed'));
    }
  }
});

// Upload and convert EPUB to HTML, or store PDF
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    // ファイル名をUTF-8にデコード（multerはlatin1でエンコードする）
    const originalFilename = decodeFilename(req.file.originalname);
    const ext = path.extname(originalFilename).toLowerCase();
    const bookId = uuidv4();
    const bookDir = path.join(convertedDir, bookId);

    // Get title from filename
    const bookTitle = path.basename(originalFilename, ext)
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2');

    if (ext === '.pdf') {
      // Handle PDF upload
      fs.mkdirSync(bookDir, { recursive: true });
      
      // Copy PDF to book directory (use copy+delete instead of rename for cross-device support)
      const pdfPath = path.join(bookDir, 'document.pdf');
      fs.copyFileSync(filePath, pdfPath);
      fs.unlinkSync(filePath);
      
      // Save to database (PDF has 1 "page" in our system, actual pages handled by viewer)
      db.addBook(bookId, bookTitle, originalFilename, 1, 'pdf');
      
      return res.json({
        success: true,
        bookId,
        title: bookTitle,
        bookType: 'pdf',
        totalPages: 1
      });
    }

    // Handle EPUB upload (existing logic)
    const epubPath = filePath;
    const mediaDir = path.join(bookDir, 'media');
    const outputHtml = path.join(bookDir, 'index.html');

    // Create directories
    fs.mkdirSync(bookDir, { recursive: true });
    fs.mkdirSync(mediaDir, { recursive: true });

    // Convert EPUB to HTML using pandoc
    const pandocCmd = `pandoc "${epubPath}" --standalone --extract-media="${mediaDir}" --toc --metadata title="${bookTitle}" -o "${outputHtml}"`;
    
    try {
      execSync(pandocCmd, { stdio: 'pipe' });
    } catch (pandocError) {
      console.error('Pandoc error:', pandocError.message);
      return res.status(500).json({ error: 'Failed to convert EPUB. Make sure pandoc is installed.' });
    }

    // Read HTML and split into pages
    let htmlContent = fs.readFileSync(outputHtml, 'utf8');
    
    // Extract TOC and body
    const pages = splitIntoPages(htmlContent, bookDir);
    
    // Save book info to database
    db.addBook(bookId, bookTitle, originalFilename, pages.length, 'epub');

    // Clean up original epub
    fs.unlinkSync(epubPath);

    res.json({
      success: true,
      bookId,
      title: bookTitle,
      bookType: 'epub',
      totalPages: pages.length
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get PDF file
app.get('/api/books/:bookId/pdf', (req, res) => {
  const { bookId } = req.params;
  const pdfPath = path.join(convertedDir, bookId, 'document.pdf');
  
  if (!fs.existsSync(pdfPath)) {
    return res.status(404).json({ error: 'PDF not found' });
  }
  
  res.sendFile(pdfPath);
});

// Split HTML content into pages
function splitIntoPages(htmlContent, bookDir) {
  // Extract head section
  const headMatch = htmlContent.match(/<head>([\s\S]*?)<\/head>/i);
  const headContent = headMatch ? headMatch[1] : '';
  
  // Extract body content
  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : htmlContent;

  // Extract TOC (table of contents)
  const tocMatch = bodyContent.match(/<nav[^>]*id="TOC"[^>]*>([\s\S]*?)<\/nav>/i);
  const tocContent = tocMatch ? tocMatch[0] : '';
  
  // Remove TOC from body for splitting
  let contentWithoutToc = bodyContent.replace(/<nav[^>]*id="TOC"[^>]*>[\s\S]*?<\/nav>/i, '');

  // Split by major sections (h1, h2) or chapter markers
  const sectionRegex = /(<(?:section|div)[^>]*class="[^"]*level1[^"]*"[^>]*>[\s\S]*?<\/(?:section|div)>)|(<h1[^>]*>[\s\S]*?)(?=<h1|$)/gi;
  let sections = contentWithoutToc.match(sectionRegex);
  
  // If no sections found, split by h2 or create single page
  if (!sections || sections.length === 0) {
    const h2Regex = /<h2[^>]*>[\s\S]*?(?=<h2|$)/gi;
    sections = contentWithoutToc.match(h2Regex);
  }
  
  // If still no sections, treat entire content as one page
  if (!sections || sections.length === 0) {
    sections = [contentWithoutToc];
  }

  // Create pages directory
  const pagesDir = path.join(bookDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });

  // Save TOC
  fs.writeFileSync(path.join(bookDir, 'toc.html'), tocContent);
  
  // Add custom styles
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
      pre { 
        background: #f4f4f4; 
        padding: 15px; 
        overflow-x: auto;
        border-radius: 5px;
      }
      code { 
        background: #f4f4f4; 
        padding: 2px 6px;
        border-radius: 3px;
      }
      h1, h2, h3 { color: #2c3e50; }
      a { color: #3498db; }
    </style>
  `;

  // Save each page
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

  // Save pages index
  fs.writeFileSync(
    path.join(bookDir, 'pages.json'),
    JSON.stringify({ total: pages.length, pages })
  );

  return pages;
}

// Get all books
app.get('/api/books', (req, res) => {
  try {
    const books = db.getAllBooks();
    res.json(books);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get book info
app.get('/api/books/:bookId', (req, res) => {
  try {
    const book = db.getBook(req.params.bookId);
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }
    
    // PDFの場合はpages.jsonがないのでそのまま返す
    // category が 'pdf' または original_filename が .pdf で終わる場合
    const isPdf = book.category === 'pdf' || 
                  (book.original_filename && book.original_filename.toLowerCase().endsWith('.pdf'));
    
    if (isPdf) {
      return res.json({ ...book, category: 'pdf', total: 1, pages: [] });
    }
    
    const pagesPath = path.join(convertedDir, req.params.bookId, 'pages.json');
    
    // pages.jsonが存在しない場合のフォールバック
    if (!fs.existsSync(pagesPath)) {
      return res.json({ ...book, total: book.total_pages || 1, pages: [] });
    }
    
    const pagesInfo = JSON.parse(fs.readFileSync(pagesPath, 'utf8'));
    
    res.json({ ...book, ...pagesInfo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get book page content
app.get('/api/books/:bookId/page/:pageNum', (req, res) => {
  try {
    const { bookId, pageNum } = req.params;
    const pagePath = path.join(convertedDir, bookId, 'pages', `page-${pageNum}.html`);
    
    if (!fs.existsSync(pagePath)) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const content = fs.readFileSync(pagePath, 'utf8');
    res.json({ content, pageNum: parseInt(pageNum) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all pages content
app.get('/api/books/:bookId/all-pages', (req, res) => {
  try {
    const { bookId } = req.params;
    const pagesPath = path.join(convertedDir, bookId, 'pages.json');
    
    if (!fs.existsSync(pagesPath)) {
      return res.status(404).json({ error: 'Book not found' });
    }
    
    const pagesInfo = JSON.parse(fs.readFileSync(pagesPath, 'utf8'));
    const pages = [];
    
    for (let i = 1; i <= pagesInfo.total; i++) {
      const pagePath = path.join(convertedDir, bookId, 'pages', `page-${i}.html`);
      if (fs.existsSync(pagePath)) {
        const content = fs.readFileSync(pagePath, 'utf8');
        // Extract body content only
        const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        pages.push({
          pageNum: i,
          content: bodyMatch ? bodyMatch[1] : content
        });
      }
    }
    
    res.json({ pages, total: pagesInfo.total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get book TOC - extract headings from all pages
app.get('/api/books/:bookId/toc', (req, res) => {
  try {
    const { bookId } = req.params;
    const pagesPath = path.join(convertedDir, bookId, 'pages.json');
    
    if (!fs.existsSync(pagesPath)) {
      return res.json({ toc: [] });
    }
    
    const pagesInfo = JSON.parse(fs.readFileSync(pagesPath, 'utf8'));
    const toc = [];
    
    // Extract headings from each page
    for (let i = 1; i <= pagesInfo.total; i++) {
      const pagePath = path.join(convertedDir, bookId, 'pages', `page-${i}.html`);
      if (fs.existsSync(pagePath)) {
        const content = fs.readFileSync(pagePath, 'utf8');
        
        // Extract h1, h2, h3 headings
        const headingRegex = /<h([123])[^>]*>([^<]*(?:<[^/h][^>]*>[^<]*<\/[^h][^>]*>)*[^<]*)<\/h\1>/gi;
        let match;
        
        while ((match = headingRegex.exec(content)) !== null) {
          const level = parseInt(match[1]);
          // Clean up the heading text (remove HTML tags)
          const title = match[2].replace(/<[^>]*>/g, '').trim();
          
          if (title && title.length > 0 && title.length < 200) {
            toc.push({
              page: i,
              level,
              title
            });
          }
        }
      }
    }
    
    res.json({ toc });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bookmark APIs
app.get('/api/books/:bookId/bookmarks', (req, res) => {
  try {
    const bookmarks = db.getBookmarks(req.params.bookId);
    res.json(bookmarks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/books/:bookId/bookmarks', (req, res) => {
  try {
    const { pageNum, note } = req.body;
    const bookmark = db.addBookmark(req.params.bookId, pageNum, note);
    res.json(bookmark);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/bookmarks/:bookmarkId', (req, res) => {
  try {
    db.deleteBookmark(req.params.bookmarkId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clips APIs (screenshot captures)
app.get('/api/books/:bookId/clips', (req, res) => {
  try {
    const clips = db.getClips(req.params.bookId);
    res.json(clips);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clips/:clipId', (req, res) => {
  try {
    const clip = db.getClip(req.params.clipId);
    if (!clip) {
      return res.status(404).json({ error: 'Clip not found' });
    }
    res.json(clip);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/books/:bookId/clips', (req, res) => {
  try {
    const { pageNum, imageData, note, position } = req.body;
    if (!imageData) {
      return res.status(400).json({ error: 'imageData is required' });
    }
    const clip = db.addClip(req.params.bookId, pageNum, imageData, note, position);
    res.json(clip);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/clips/:clipId', (req, res) => {
  try {
    db.deleteClip(req.params.clipId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reading progress
app.get('/api/books/:bookId/progress', (req, res) => {
  try {
    const progress = db.getProgress(req.params.bookId);
    res.json(progress || { currentPage: 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/books/:bookId/progress', (req, res) => {
  try {
    const { currentPage } = req.body;
    db.saveProgress(req.params.bookId, currentPage);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete book
app.delete('/api/books/:bookId', (req, res) => {
  try {
    const { bookId } = req.params;
    
    // Delete from database
    db.deleteBook(bookId);
    
    // Delete files
    const bookDir = path.join(convertedDir, bookId);
    if (fs.existsSync(bookDir)) {
      fs.rmSync(bookDir, { recursive: true });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update book info
app.patch('/api/books/:bookId', (req, res) => {
  try {
    const { bookId } = req.params;
    const { title, language } = req.body;
    
    const updated = db.updateBook(bookId, { title, language });
    if (!updated) {
      return res.status(404).json({ error: 'Book not found' });
    }
    
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve media files
app.get('/api/books/:bookId/media/*', (req, res) => {
  const mediaPath = path.join(convertedDir, req.params.bookId, 'media', req.params[0]);
  if (fs.existsSync(mediaPath)) {
    res.sendFile(mediaPath);
  } else {
    res.status(404).json({ error: 'Media not found' });
  }
});

// Upload custom cover image for a book
const coverUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const bookDir = path.join(convertedDir, req.params.bookId);
      if (!fs.existsSync(bookDir)) {
        return cb(new Error('Book not found'));
      }
      cb(null, bookDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `custom-cover${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

app.post('/api/books/:bookId/cover', coverUpload.single('cover'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const { bookId } = req.params;
    const bookDir = path.join(convertedDir, bookId);
    
    // Remove old custom covers (different extensions)
    const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    for (const ext of extensions) {
      const oldCover = path.join(bookDir, `custom-cover${ext}`);
      if (oldCover !== req.file.path && fs.existsSync(oldCover)) {
        fs.unlinkSync(oldCover);
      }
    }
    
    res.json({ success: true, message: 'Cover updated' });
  } catch (error) {
    console.error('Cover upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete custom cover (revert to original)
app.delete('/api/books/:bookId/cover', (req, res) => {
  try {
    const { bookId } = req.params;
    const bookDir = path.join(convertedDir, bookId);
    
    // Remove custom covers
    const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    let deleted = false;
    for (const ext of extensions) {
      const coverPath = path.join(bookDir, `custom-cover${ext}`);
      if (fs.existsSync(coverPath)) {
        fs.unlinkSync(coverPath);
        deleted = true;
      }
    }
    
    res.json({ success: true, deleted });
  } catch (error) {
    console.error('Cover delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get cover image for a book
app.get('/api/books/:bookId/cover', async (req, res) => {
  const { bookId } = req.params;
  const bookDir = path.join(convertedDir, bookId);
  const mediaDir = path.join(bookDir, 'media');
  
  // PDFの場合、pages.jsonがないことで判定
  const pagesJsonPath = path.join(bookDir, 'pages.json');
  const pdfPath = path.join(bookDir, 'original.pdf');
  
  // PDFの場合は1ページ目のサムネイルを生成
  if (!fs.existsSync(pagesJsonPath) && fs.existsSync(pdfPath)) {
    // カスタムカバーがあればそちらを優先
    const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    for (const ext of extensions) {
      const customCover = path.join(bookDir, `custom-cover${ext}`);
      if (fs.existsSync(customCover)) {
        return res.sendFile(customCover);
      }
    }
    
    // PDFサムネイルがキャッシュされていればそれを返す
    const thumbnailPath = path.join(bookDir, 'pdf-thumbnail.png');
    if (fs.existsSync(thumbnailPath)) {
      return res.sendFile(thumbnailPath);
    }
    
    // pdftoppmでサムネイル生成を試みる
    try {
      const thumbPrefix = path.join(bookDir, 'pdf-thumb');
      execSync(`pdftoppm -png -f 1 -l 1 -scale-to 400 "${pdfPath}" "${thumbPrefix}"`, { timeout: 30000 });
      
      // pdftoppmは pdf-thumb-1.png または pdf-thumb-01.png を生成する
      const possibleFiles = [
        `${thumbPrefix}-1.png`,
        `${thumbPrefix}-01.png`,
        `${thumbPrefix}-001.png`
      ];
      
      for (const thumbFile of possibleFiles) {
        if (fs.existsSync(thumbFile)) {
          fs.renameSync(thumbFile, thumbnailPath);
          console.log(`PDF thumbnail generated: ${thumbnailPath}`);
          return res.sendFile(thumbnailPath);
        }
      }
      
      // ディレクトリ内のpdf-thumb*.pngを探す
      const files = fs.readdirSync(bookDir);
      const thumbMatch = files.find(f => f.startsWith('pdf-thumb') && f.endsWith('.png'));
      if (thumbMatch) {
        const matchPath = path.join(bookDir, thumbMatch);
        fs.renameSync(matchPath, thumbnailPath);
        console.log(`PDF thumbnail generated from ${thumbMatch}: ${thumbnailPath}`);
        return res.sendFile(thumbnailPath);
      }
      
      console.log('pdftoppm ran but no output file found');
    } catch (e) {
      console.error('pdftoppm error:', e.message);
    }
    
    return res.status(404).json({ error: 'No cover found for PDF' });
  }
  
  // First check for custom cover
  const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
  for (const ext of extensions) {
    const customCover = path.join(bookDir, `custom-cover${ext}`);
    if (fs.existsSync(customCover)) {
      return res.sendFile(customCover);
    }
  }
  
  if (!fs.existsSync(mediaDir)) {
    return res.status(404).json({ error: 'No media found' });
  }
  
  // Find cover image - check common patterns
  const findCover = (dir) => {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      
      if (item.isDirectory()) {
        const found = findCover(fullPath);
        if (found) return found;
      } else if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
          const name = item.name.toLowerCase();
          // Prioritize cover images
          if (name.includes('cover')) {
            return fullPath;
          }
        }
      }
    }
    return null;
  };
  
  // First try to find a cover image
  let coverPath = findCover(mediaDir);
  
  // If no cover found, get the first image
  if (!coverPath) {
    const findFirstImage = (dir) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        
        if (item.isDirectory()) {
          const found = findFirstImage(fullPath);
          if (found) return found;
        } else if (item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
            return fullPath;
          }
        }
      }
      return null;
    };
    coverPath = findFirstImage(mediaDir);
  }
  
  if (coverPath && fs.existsSync(coverPath)) {
    res.sendFile(coverPath);
  } else {
    res.status(404).json({ error: 'No cover found' });
  }
});

// Serve React app for all other routes in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
