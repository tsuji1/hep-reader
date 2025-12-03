import * as cheerio from 'cheerio';
import { execSync } from 'child_process';
import cors from 'cors';
import express, { Request, Response } from 'express';
import fs from 'fs';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import db from './database';
import type { ClipPosition, PagesInfo, TocItem, WebsiteMetadata } from './types';

const app = express();
const PORT = process.env.PORT || 3001;

// ファイル名のデコードユーティリティ
// multerはlatin1でエンコードするため、UTF-8にデコード
function decodeFilename(filename: string): string {
  try {
    return Buffer.from(filename, 'latin1').toString('utf8');
  } catch (e) {
    return filename;
  }
}

// ルートディレクトリ（コンパイル後は server/dist/ にあるため2階層上）
const ROOT_DIR = path.join(__dirname, '../..');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(ROOT_DIR, 'uploads')));
app.use('/converted', express.static(path.join(ROOT_DIR, 'converted')));

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(ROOT_DIR, 'client/dist')));
}

// Ensure directories exist
const uploadsDir = path.join(ROOT_DIR, 'uploads');
const convertedDir = path.join(ROOT_DIR, 'converted');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(convertedDir)) fs.mkdirSync(convertedDir, { recursive: true });

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.epub' || ext === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only EPUB and PDF files are allowed'));
    }
  }
});

// Split HTML content into pages
function splitIntoPages(htmlContent: string, bookDir: string): string[] {
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

// Upload and convert EPUB to HTML, or store PDF
app.post('/api/upload', upload.single('file'), async (req: Request, res: Response) => {
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
      console.error('Pandoc error:', (pandocError as Error).message);
      return res.status(500).json({ error: 'Failed to convert EPUB. Make sure pandoc is installed.' });
    }

    // Read HTML and split into pages
    const htmlContent = fs.readFileSync(outputHtml, 'utf8');
    
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
    res.status(500).json({ error: (error as Error).message });
  }
});

// ===== Website Scraping =====

// Use global fetch Response type
type FetchResponse = Awaited<ReturnType<typeof fetch>>;

// Helper: Fetch with timeout
async function fetchWithTimeout(url: string, timeout = 30000): Promise<FetchResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      }
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Helper: Extract metadata from HTML
function extractMetadata(html: string, baseUrl: string): WebsiteMetadata {
  const $ = cheerio.load(html);
  
  // Get title
  const ogTitle = $('meta[property="og:title"]').attr('content');
  const twitterTitle = $('meta[name="twitter:title"]').attr('content');
  const title = ogTitle || twitterTitle || $('title').text().trim() || 'Untitled';
  
  // Get description
  const ogDescription = $('meta[property="og:description"]').attr('content');
  const metaDescription = $('meta[name="description"]').attr('content');
  const description = ogDescription || metaDescription || null;
  
  // Get OG image
  const ogImage = $('meta[property="og:image"]').attr('content') || 
                  $('meta[name="twitter:image"]').attr('content') || null;
  
  // Get favicon
  let favicon = $('link[rel="icon"]').attr('href') ||
                $('link[rel="shortcut icon"]').attr('href') ||
                '/favicon.ico';
  
  // Get site name
  const siteName = $('meta[property="og:site_name"]').attr('content') || null;
  
  // Resolve relative URLs
  const resolveUrl = (url: string | null): string | null => {
    if (!url) return null;
    try {
      return new URL(url, baseUrl).href;
    } catch {
      return url;
    }
  };
  
  return {
    title,
    description,
    ogImage: resolveUrl(ogImage),
    favicon: resolveUrl(favicon),
    siteName
  };
}

// Helper: Extract and clean article content
function extractArticleContent(html: string, baseUrl: string): { content: string; images: string[] } {
  const $ = cheerio.load(html);
  const images: string[] = [];
  
  // Remove unwanted elements
  $('script, style, nav, header, footer, aside, .ads, .advertisement, .sidebar, .menu, .navigation, .comment, .comments, #comments, .social-share, .share-buttons, .related-posts, iframe, noscript').remove();
  
  // Try to find main content
  let $content = $('article').first();
  if ($content.length === 0) $content = $('main').first();
  if ($content.length === 0) $content = $('[role="main"]').first();
  if ($content.length === 0) $content = $('.post-content, .article-content, .entry-content, .content, #content').first();
  if ($content.length === 0) $content = $('body');
  
  // Process images - collect and update src
  $content.find('img').each((_, img) => {
    const $img = $(img);
    let src = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src');
    if (src) {
      try {
        const absoluteUrl = new URL(src, baseUrl).href;
        images.push(absoluteUrl);
        $img.attr('src', `media/${images.length - 1}.img`);
        $img.removeAttr('data-src');
        $img.removeAttr('data-lazy-src');
        $img.removeAttr('srcset');
        $img.removeAttr('loading');
      } catch {
        // Invalid URL, remove image
        $img.remove();
      }
    }
  });
  
  // Clean up attributes
  $content.find('*').each((_, el) => {
    const $el = $(el);
    // Keep only essential attributes
    const allowedAttrs = ['src', 'href', 'alt', 'title'];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attrs = Object.keys((el as any).attribs || {});
    attrs.forEach(attr => {
      if (!allowedAttrs.includes(attr)) {
        $el.removeAttr(attr);
      }
    });
  });
  
  // Remove empty elements
  $content.find('div, span, p').each((_, el) => {
    const $el = $(el);
    if ($el.text().trim() === '' && $el.find('img').length === 0) {
      $el.remove();
    }
  });
  
  return {
    content: $content.html() || '',
    images
  };
}

// Helper: Download image
async function downloadImage(url: string, destPath: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(url, 15000);
    if (!response.ok) return false;
    
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    return true;
  } catch (e) {
    console.error(`Failed to download image: ${url}`, (e as Error).message);
    return false;
  }
}

// Helper: Split content by h2 headings and add markdown-style prefixes
function splitContentByHeadings(content: string, _title: string): string[] {
  const $ = cheerio.load(content);
  
  // Add markdown-style prefixes to headings
  $('h1').each((_, el) => {
    const $el = $(el);
    const text = $el.text();
    if (!text.startsWith('# ')) {
      $el.prepend('# ');
    }
  });
  
  $('h2').each((_, el) => {
    const $el = $(el);
    const text = $el.text();
    if (!text.startsWith('## ')) {
      $el.prepend('## ');
    }
  });
  
  $('h3').each((_, el) => {
    const $el = $(el);
    const text = $el.text();
    if (!text.startsWith('### ')) {
      $el.prepend('### ');
    }
  });
  
  // Get the modified HTML
  const modifiedContent = $.html();
  
  // Check if there are any h2 headings
  const headings = $('h2');
  if (headings.length === 0) {
    // No h2 headings, return as single page
    return [modifiedContent];
  }
  
  // Use regex to split by h2 tags (works regardless of nesting)
  // This regex captures everything before and after each h2
  const h2Regex = /(<h2[^>]*>)/gi;
  const parts = modifiedContent.split(h2Regex);
  
  if (parts.length <= 1) {
    return [modifiedContent];
  }
  
  const sections: string[] = [];
  let currentSection = '';
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    
    if (h2Regex.test(part) || part.match(/^<h2[^>]*>$/i)) {
      // This is an h2 opening tag
      // Save previous section if it has meaningful content
      const trimmedSection = currentSection.replace(/<[^>]*>/g, '').trim();
      if (trimmedSection.length > 20) {
        sections.push(currentSection);
      }
      // Start new section with this h2 tag
      currentSection = part;
    } else {
      // Add to current section
      currentSection += part;
    }
  }
  
  // Don't forget the last section
  const trimmedLast = currentSection.replace(/<[^>]*>/g, '').trim();
  if (trimmedLast.length > 20) {
    sections.push(currentSection);
  }
  
  // If we only got one or no sections, return the full content
  if (sections.length <= 1) {
    return [modifiedContent];
  }
  
  return sections;
}

// Save website URL
app.post('/api/save-url', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }
    
    // Fetch the page
    console.log(`Fetching URL: ${url}`);
    const response = await fetchWithTimeout(url);
    
    if (!response.ok) {
      return res.status(400).json({ error: `Failed to fetch URL: ${response.status} ${response.statusText}` });
    }
    
    const html = await response.text();
    
    // Extract metadata
    const metadata = extractMetadata(html, url);
    console.log(`Metadata: ${JSON.stringify(metadata)}`);
    
    // Extract content and images
    const { content, images } = extractArticleContent(html, url);
    
    // Create book directory
    const bookId = uuidv4();
    const bookDir = path.join(convertedDir, bookId);
    const mediaDir = path.join(bookDir, 'media');
    const pagesDir = path.join(bookDir, 'pages');
    
    fs.mkdirSync(bookDir, { recursive: true });
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.mkdirSync(pagesDir, { recursive: true });
    
    // Download images
    console.log(`Downloading ${images.length} images...`);
    for (let i = 0; i < images.length; i++) {
      const imgUrl = images[i];
      const ext = path.extname(new URL(imgUrl).pathname) || '.jpg';
      const imgPath = path.join(mediaDir, `${i}${ext}`);
      await downloadImage(imgUrl, imgPath);
    }
    
    // Download OG image as cover
    if (metadata.ogImage) {
      const coverExt = path.extname(new URL(metadata.ogImage).pathname) || '.jpg';
      const coverPath = path.join(bookDir, `custom-cover${coverExt}`);
      await downloadImage(metadata.ogImage, coverPath);
    }
    
    // Fix image paths in content (update extensions)
    let fixedContent = content;
    for (let i = 0; i < images.length; i++) {
      const imgUrl = images[i];
      const ext = path.extname(new URL(imgUrl).pathname) || '.jpg';
      fixedContent = fixedContent.replace(new RegExp(`media/${i}\\.img`, 'g'), `media/${i}${ext}`);
    }
    
    // Split content by h1/h2 headings
    const contentSections = splitContentByHeadings(fixedContent, metadata.title);
    const totalPages = contentSections.length;
    console.log(`Split into ${totalPages} pages`);
    
    // Create page HTML template
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
        img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
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
        blockquote { border-left: 4px solid #3498db; margin: 1em 0; padding-left: 1em; color: #666; }
      </style>
    `;
    
    // Save each page
    const pageFiles: string[] = [];
    for (let i = 0; i < contentSections.length; i++) {
      const pageNum = i + 1;
      const isFirstPage = i === 0;
      const sectionContent = contentSections[i];
      
      const pageHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${metadata.title}</title>
  ${customStyles}
</head>
<body>
  ${isFirstPage ? `<h1>${metadata.title}</h1>` : ''}
  ${isFirstPage && metadata.siteName ? `<p style="color: #666; font-size: 0.9em;">Source: ${metadata.siteName}</p>` : ''}
  ${isFirstPage ? '<hr>' : ''}
  ${sectionContent}
  ${pageNum === totalPages ? `<hr><p style="color: #666; font-size: 0.9em;">Original: <a href="${url}" target="_blank">${url}</a></p>` : ''}
</body>
</html>`;
      
      const pageFile = `page-${pageNum}.html`;
      fs.writeFileSync(path.join(pagesDir, pageFile), pageHtml);
      pageFiles.push(pageFile);
    }
    
    // Save pages index
    fs.writeFileSync(
      path.join(bookDir, 'pages.json'),
      JSON.stringify({ total: totalPages, pages: pageFiles })
    );
    
    // Save metadata
    fs.writeFileSync(
      path.join(bookDir, 'metadata.json'),
      JSON.stringify({ ...metadata, sourceUrl: url, savedAt: new Date().toISOString() })
    );
    
    // Save to database
    db.addWebsiteBook(bookId, metadata.title, url, totalPages);
    
    res.json({
      success: true,
      bookId,
      title: metadata.title,
      bookType: 'website',
      totalPages,
      metadata
    });
  } catch (error) {
    console.error('Save URL error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get PDF file
app.get('/api/books/:bookId/pdf', (req: Request, res: Response) => {
  const { bookId } = req.params;
  const pdfPath = path.join(convertedDir, bookId, 'document.pdf');
  
  if (!fs.existsSync(pdfPath)) {
    return res.status(404).json({ error: 'PDF not found' });
  }
  
  res.sendFile(pdfPath);
});

// Get all books
app.get('/api/books', (_req: Request, res: Response) => {
  try {
    const books = db.getAllBooks();
    res.json(books);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get book info
app.get('/api/books/:bookId', (req: Request, res: Response) => {
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
    
    const pagesInfo: PagesInfo = JSON.parse(fs.readFileSync(pagesPath, 'utf8'));
    
    res.json({ ...book, ...pagesInfo });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get book page content
app.get('/api/books/:bookId/page/:pageNum', (req: Request, res: Response) => {
  try {
    const { bookId, pageNum } = req.params;
    const pagePath = path.join(convertedDir, bookId, 'pages', `page-${pageNum}.html`);
    
    if (!fs.existsSync(pagePath)) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const content = fs.readFileSync(pagePath, 'utf8');
    res.json({ content, pageNum: parseInt(pageNum) });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get all pages content
app.get('/api/books/:bookId/all-pages', (req: Request, res: Response) => {
  try {
    const { bookId } = req.params;
    const pagesPath = path.join(convertedDir, bookId, 'pages.json');
    
    if (!fs.existsSync(pagesPath)) {
      return res.status(404).json({ error: 'Book not found' });
    }
    
    const pagesInfo: PagesInfo = JSON.parse(fs.readFileSync(pagesPath, 'utf8'));
    const pages: { pageNum: number; content: string }[] = [];
    
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
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get book TOC - extract headings from all pages
app.get('/api/books/:bookId/toc', (req: Request, res: Response) => {
  try {
    const { bookId } = req.params;
    const pagesPath = path.join(convertedDir, bookId, 'pages.json');
    
    if (!fs.existsSync(pagesPath)) {
      return res.json({ toc: [] });
    }
    
    const pagesInfo: PagesInfo = JSON.parse(fs.readFileSync(pagesPath, 'utf8'));
    const toc: TocItem[] = [];
    
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
    res.status(500).json({ error: (error as Error).message });
  }
});

// Bookmark APIs
app.get('/api/books/:bookId/bookmarks', (req: Request, res: Response) => {
  try {
    const bookmarks = db.getBookmarks(req.params.bookId);
    res.json(bookmarks);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/books/:bookId/bookmarks', (req: Request, res: Response) => {
  try {
    const { pageNum, note } = req.body;
    const bookmark = db.addBookmark(req.params.bookId, pageNum, note);
    res.json(bookmark);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/bookmarks/:bookmarkId', (req: Request, res: Response) => {
  try {
    db.deleteBookmark(req.params.bookmarkId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Clips APIs (screenshot captures)
app.get('/api/books/:bookId/clips', (req: Request, res: Response) => {
  try {
    const clips = db.getClips(req.params.bookId);
    res.json(clips);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/clips/:clipId', (req: Request, res: Response) => {
  try {
    const clip = db.getClip(req.params.clipId);
    if (!clip) {
      return res.status(404).json({ error: 'Clip not found' });
    }
    res.json(clip);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/books/:bookId/clips', (req: Request, res: Response) => {
  try {
    const { pageNum, imageData, note, position } = req.body as {
      pageNum: number;
      imageData: string;
      note?: string;
      position?: ClipPosition;
    };
    if (!imageData) {
      return res.status(400).json({ error: 'imageData is required' });
    }
    const clip = db.addClip(req.params.bookId, pageNum, imageData, note, position);
    res.json(clip);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/clips/:clipId', (req: Request, res: Response) => {
  try {
    db.deleteClip(req.params.clipId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Reading progress
app.get('/api/books/:bookId/progress', (req: Request, res: Response) => {
  try {
    const progress = db.getProgress(req.params.bookId);
    res.json(progress || { currentPage: 1 });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/books/:bookId/progress', (req: Request, res: Response) => {
  try {
    const { currentPage } = req.body;
    db.saveProgress(req.params.bookId, currentPage);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete book
app.delete('/api/books/:bookId', (req: Request, res: Response) => {
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
    res.status(500).json({ error: (error as Error).message });
  }
});

// Update book info
app.patch('/api/books/:bookId', (req: Request, res: Response) => {
  try {
    const { bookId } = req.params;
    const { title, language } = req.body;
    
    const updated = db.updateBook(bookId, { title, language });
    if (!updated) {
      return res.status(404).json({ error: 'Book not found' });
    }
    
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Update PDF total pages (actual page count from PDF.js)
app.post('/api/books/:bookId/pdf-total-pages', (req: Request, res: Response) => {
  try {
    const { bookId } = req.params;
    const { totalPages } = req.body;
    
    if (typeof totalPages !== 'number' || totalPages < 1) {
      return res.status(400).json({ error: 'Invalid totalPages' });
    }
    
    db.updatePdfTotalPages(bookId, totalPages);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ===== Tags API =====

// Get all tags
app.get('/api/tags', (_req: Request, res: Response) => {
  try {
    const tags = db.getAllTags();
    res.json(tags);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Create tag
app.post('/api/tags', (req: Request, res: Response) => {
  try {
    const { name, color } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Tag name is required' });
    }
    const tag = db.createTag(name.trim(), color || '#667eea');
    res.json(tag);
  } catch (error: unknown) {
    const err = error as { code?: string; message: string };
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ error: 'Tag already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Delete tag
app.delete('/api/tags/:tagId', (req: Request, res: Response) => {
  try {
    db.deleteTag(req.params.tagId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get tags for a book
app.get('/api/books/:bookId/tags', (req: Request, res: Response) => {
  try {
    const tags = db.getBookTags(req.params.bookId);
    res.json(tags);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Add tag to book
app.post('/api/books/:bookId/tags', (req: Request, res: Response) => {
  try {
    const { tagId } = req.body;
    if (!tagId) {
      return res.status(400).json({ error: 'tagId is required' });
    }
    db.addTagToBook(req.params.bookId, tagId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Remove tag from book
app.delete('/api/books/:bookId/tags/:tagId', (req: Request, res: Response) => {
  try {
    db.removeTagFromBook(req.params.bookId, req.params.tagId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Serve media files
app.get('/api/books/:bookId/media/*', (req: Request, res: Response) => {
  const mediaPath = path.join(convertedDir, req.params.bookId, 'media', req.params[0]);
  if (fs.existsSync(mediaPath)) {
    res.sendFile(mediaPath);
  } else {
    res.status(404).json({ error: 'Media not found' });
  }
});

// Upload custom cover image for a book
const coverStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const bookDir = path.join(convertedDir, req.params.bookId);
    if (!fs.existsSync(bookDir)) {
      return cb(new Error('Book not found'), '');
    }
    cb(null, bookDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `custom-cover${ext}`);
  }
});

const coverUpload = multer({
  storage: coverStorage,
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

app.post('/api/books/:bookId/cover', coverUpload.single('cover'), (req: Request, res: Response) => {
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
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete custom cover (revert to original)
app.delete('/api/books/:bookId/cover', (req: Request, res: Response) => {
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
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get cover image for a book
app.get('/api/books/:bookId/cover', async (req: Request, res: Response) => {
  const { bookId } = req.params;
  const bookDir = path.join(convertedDir, bookId);
  const mediaDir = path.join(bookDir, 'media');
  
  // ブックディレクトリが存在しない場合
  if (!fs.existsSync(bookDir)) {
    return res.status(404).json({ error: 'Book directory not found' });
  }
  
  // PDFの場合、pages.jsonがないことで判定
  const pagesJsonPath = path.join(bookDir, 'pages.json');
  // PDFファイルは document.pdf として保存される
  const pdfPath = path.join(bookDir, 'document.pdf');
  
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
      console.error('pdftoppm error:', (e as Error).message);
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
  const findCover = (dir: string): string | null => {
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
    const findFirstImage = (dir: string): string | null => {
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

// ==================== AI Settings APIs ====================

// Get all AI settings (hides API keys)
app.get('/api/ai/settings', (_req: Request, res: Response) => {
  try {
    const settings = db.getAiSettings();
    // Hide actual API keys, just show if configured
    const safeSettings = settings.map((s: { provider: string; model: string | null; api_key: string }) => ({
      provider: s.provider,
      model: s.model,
      configured: !!s.api_key
    }));
    res.json(safeSettings);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Save AI setting
app.post('/api/ai/settings', (req: Request, res: Response) => {
  try {
    const { provider, apiKey, model } = req.body;
    if (!provider || !apiKey) {
      return res.status(400).json({ error: 'provider and apiKey are required' });
    }
    const validProviders = ['gemini', 'claude', 'openai'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider. Use: gemini, claude, openai' });
    }
    db.saveAiSetting(provider, apiKey, model);
    res.json({ success: true, provider, model });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete AI setting
app.delete('/api/ai/settings/:provider', (req: Request, res: Response) => {
  try {
    db.deleteAiSetting(req.params.provider);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Chat with AI
app.post('/api/ai/chat', async (req: Request, res: Response) => {
  try {
    const { provider, message, context } = req.body;
    if (!provider || !message) {
      return res.status(400).json({ error: 'provider and message are required' });
    }

    const setting = db.getAiSetting(provider);
    if (!setting || !setting.api_key) {
      return res.status(400).json({ error: `${provider} API key is not configured` });
    }

    const apiKey = setting.api_key;
    let response: string;

    // Build prompt with context
    const systemPrompt = context 
      ? `あなたは読書アシスタントです。ユーザーが読んでいる本の内容について質問に答えてください。\n\n現在の本の内容:\n${context}`
      : 'あなたは読書アシスタントです。ユーザーの質問に答えてください。';

    if (provider === 'openai') {
      const model = setting.model || 'gpt-4o-mini';
      const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message }
          ],
          max_tokens: 2000
        })
      });
      const data = await apiRes.json() as { error?: { message: string }; choices?: { message?: { content?: string } }[] };
      if (data.error) {
        throw new Error(data.error.message);
      }
      response = data.choices?.[0]?.message?.content || 'No response';
    } else if (provider === 'claude') {
      const model = setting.model || 'claude-sonnet-4-20250514';
      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          system: systemPrompt,
          messages: [
            { role: 'user', content: message }
          ]
        })
      });
      const data = await apiRes.json() as { error?: { message: string }; content?: { text?: string }[] };
      if (data.error) {
        throw new Error(data.error.message);
      }
      response = data.content?.[0]?.text || 'No response';
    } else if (provider === 'gemini') {
      const model = setting.model || 'gemini-2.0-flash';
      const apiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: `${systemPrompt}\n\nユーザーの質問: ${message}` }]
            }]
          })
        }
      );
      const data = await apiRes.json() as { error?: { message: string }; candidates?: { content?: { parts?: { text?: string }[] } }[] };
      if (data.error) {
        throw new Error(data.error.message);
      }
      response = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
    } else {
      return res.status(400).json({ error: 'Unknown provider' });
    }

    res.json({ response });
  } catch (error) {
    console.error('AI chat error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Serve React app for all other routes in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(ROOT_DIR, 'client/dist/index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

export default app;
