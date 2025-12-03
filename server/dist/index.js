"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cheerio = __importStar(require("cheerio"));
const child_process_1 = require("child_process");
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const database_1 = __importDefault(require("./database"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// ファイル名のデコードユーティリティ
// multerはlatin1でエンコードするため、UTF-8にデコード
function decodeFilename(filename) {
    try {
        return Buffer.from(filename, 'latin1').toString('utf8');
    }
    catch (e) {
        return filename;
    }
}
// ルートディレクトリ（コンパイル後は server/dist/ にあるため2階層上）
const ROOT_DIR = path_1.default.join(__dirname, '../..');
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express_1.default.static(path_1.default.join(ROOT_DIR, 'uploads')));
app.use('/converted', express_1.default.static(path_1.default.join(ROOT_DIR, 'converted')));
// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    app.use(express_1.default.static(path_1.default.join(ROOT_DIR, 'client/dist')));
}
// Ensure directories exist
const uploadsDir = path_1.default.join(ROOT_DIR, 'uploads');
const convertedDir = path_1.default.join(ROOT_DIR, 'converted');
if (!fs_1.default.existsSync(uploadsDir))
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
if (!fs_1.default.existsSync(convertedDir))
    fs_1.default.mkdirSync(convertedDir, { recursive: true });
// Multer configuration for file uploads
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => {
        const uniqueName = `${(0, uuid_1.v4)()}-${file.originalname}`;
        cb(null, uniqueName);
    }
});
const upload = (0, multer_1.default)({
    storage,
    fileFilter: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        if (ext === '.epub' || ext === '.pdf') {
            cb(null, true);
        }
        else {
            cb(new Error('Only EPUB and PDF files are allowed'));
        }
    }
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
    const pagesDir = path_1.default.join(bookDir, 'pages');
    fs_1.default.mkdirSync(pagesDir, { recursive: true });
    // Save TOC
    fs_1.default.writeFileSync(path_1.default.join(bookDir, 'toc.html'), tocContent);
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
        fs_1.default.writeFileSync(path_1.default.join(pagesDir, pageFile), pageHtml);
        return pageFile;
    });
    // Save pages index
    fs_1.default.writeFileSync(path_1.default.join(bookDir, 'pages.json'), JSON.stringify({ total: pages.length, pages }));
    return pages;
}
// Upload and convert EPUB to HTML, or store PDF
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const filePath = req.file.path;
        // ファイル名をUTF-8にデコード（multerはlatin1でエンコードする）
        const originalFilename = decodeFilename(req.file.originalname);
        const ext = path_1.default.extname(originalFilename).toLowerCase();
        const bookId = (0, uuid_1.v4)();
        const bookDir = path_1.default.join(convertedDir, bookId);
        // Get title from filename
        const bookTitle = path_1.default.basename(originalFilename, ext)
            .replace(/[-_]/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2');
        if (ext === '.pdf') {
            // Handle PDF upload
            fs_1.default.mkdirSync(bookDir, { recursive: true });
            // Copy PDF to book directory (use copy+delete instead of rename for cross-device support)
            const pdfPath = path_1.default.join(bookDir, 'document.pdf');
            fs_1.default.copyFileSync(filePath, pdfPath);
            fs_1.default.unlinkSync(filePath);
            // Save to database (PDF has 1 "page" in our system, actual pages handled by viewer)
            database_1.default.addBook(bookId, bookTitle, originalFilename, 1, 'pdf');
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
        const mediaDir = path_1.default.join(bookDir, 'media');
        const outputHtml = path_1.default.join(bookDir, 'index.html');
        // Create directories
        fs_1.default.mkdirSync(bookDir, { recursive: true });
        fs_1.default.mkdirSync(mediaDir, { recursive: true });
        // Convert EPUB to HTML using pandoc
        const pandocCmd = `pandoc "${epubPath}" --standalone --extract-media="${mediaDir}" --toc --metadata title="${bookTitle}" -o "${outputHtml}"`;
        try {
            (0, child_process_1.execSync)(pandocCmd, { stdio: 'pipe' });
        }
        catch (pandocError) {
            console.error('Pandoc error:', pandocError.message);
            return res.status(500).json({ error: 'Failed to convert EPUB. Make sure pandoc is installed.' });
        }
        // Read HTML and split into pages
        const htmlContent = fs_1.default.readFileSync(outputHtml, 'utf8');
        // Extract TOC and body
        const pages = splitIntoPages(htmlContent, bookDir);
        // Save book info to database
        database_1.default.addBook(bookId, bookTitle, originalFilename, pages.length, 'epub');
        // Clean up original epub
        fs_1.default.unlinkSync(epubPath);
        res.json({
            success: true,
            bookId,
            title: bookTitle,
            bookType: 'epub',
            totalPages: pages.length
        });
    }
    catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});
// Helper: Fetch with timeout
async function fetchWithTimeout(url, timeout = 30000) {
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
    }
    finally {
        clearTimeout(timeoutId);
    }
}
// Helper: Extract metadata from HTML
function extractMetadata(html, baseUrl) {
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
    const resolveUrl = (url) => {
        if (!url)
            return null;
        try {
            return new URL(url, baseUrl).href;
        }
        catch {
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
function extractArticleContent(html, baseUrl) {
    const $ = cheerio.load(html);
    const images = [];
    // Remove unwanted elements
    $('script, style, nav, header, footer, aside, .ads, .advertisement, .sidebar, .menu, .navigation, .comment, .comments, #comments, .social-share, .share-buttons, .related-posts, iframe, noscript').remove();
    // Try to find main content
    let $content = $('article').first();
    if ($content.length === 0)
        $content = $('main').first();
    if ($content.length === 0)
        $content = $('[role="main"]').first();
    if ($content.length === 0)
        $content = $('.post-content, .article-content, .entry-content, .content, #content').first();
    if ($content.length === 0)
        $content = $('body');
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
            }
            catch {
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
        const attrs = Object.keys(el.attribs || {});
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
async function downloadImage(url, destPath) {
    try {
        const response = await fetchWithTimeout(url, 15000);
        if (!response.ok)
            return false;
        const buffer = Buffer.from(await response.arrayBuffer());
        fs_1.default.writeFileSync(destPath, buffer);
        return true;
    }
    catch (e) {
        console.error(`Failed to download image: ${url}`, e.message);
        return false;
    }
}
// Helper: Split content by h2 headings and add markdown-style prefixes
function splitContentByHeadings(content, _title) {
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
    const sections = [];
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
        }
        else {
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
app.post('/api/save-url', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'URL is required' });
        }
        // Validate URL
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                throw new Error('Invalid protocol');
            }
        }
        catch {
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
        const bookId = (0, uuid_1.v4)();
        const bookDir = path_1.default.join(convertedDir, bookId);
        const mediaDir = path_1.default.join(bookDir, 'media');
        const pagesDir = path_1.default.join(bookDir, 'pages');
        fs_1.default.mkdirSync(bookDir, { recursive: true });
        fs_1.default.mkdirSync(mediaDir, { recursive: true });
        fs_1.default.mkdirSync(pagesDir, { recursive: true });
        // Download images
        console.log(`Downloading ${images.length} images...`);
        for (let i = 0; i < images.length; i++) {
            const imgUrl = images[i];
            const ext = path_1.default.extname(new URL(imgUrl).pathname) || '.jpg';
            const imgPath = path_1.default.join(mediaDir, `${i}${ext}`);
            await downloadImage(imgUrl, imgPath);
        }
        // Download OG image as cover
        if (metadata.ogImage) {
            const coverExt = path_1.default.extname(new URL(metadata.ogImage).pathname) || '.jpg';
            const coverPath = path_1.default.join(bookDir, `custom-cover${coverExt}`);
            await downloadImage(metadata.ogImage, coverPath);
        }
        // Fix image paths in content (update extensions)
        let fixedContent = content;
        for (let i = 0; i < images.length; i++) {
            const imgUrl = images[i];
            const ext = path_1.default.extname(new URL(imgUrl).pathname) || '.jpg';
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
        const pageFiles = [];
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
            fs_1.default.writeFileSync(path_1.default.join(pagesDir, pageFile), pageHtml);
            pageFiles.push(pageFile);
        }
        // Save pages index
        fs_1.default.writeFileSync(path_1.default.join(bookDir, 'pages.json'), JSON.stringify({ total: totalPages, pages: pageFiles }));
        // Save metadata
        fs_1.default.writeFileSync(path_1.default.join(bookDir, 'metadata.json'), JSON.stringify({ ...metadata, sourceUrl: url, savedAt: new Date().toISOString() }));
        // Save to database
        database_1.default.addWebsiteBook(bookId, metadata.title, url, totalPages);
        res.json({
            success: true,
            bookId,
            title: metadata.title,
            bookType: 'website',
            totalPages,
            metadata
        });
    }
    catch (error) {
        console.error('Save URL error:', error);
        res.status(500).json({ error: error.message });
    }
});
// Get PDF file
app.get('/api/books/:bookId/pdf', (req, res) => {
    const { bookId } = req.params;
    const pdfPath = path_1.default.join(convertedDir, bookId, 'document.pdf');
    if (!fs_1.default.existsSync(pdfPath)) {
        return res.status(404).json({ error: 'PDF not found' });
    }
    res.sendFile(pdfPath);
});
// Get all books
app.get('/api/books', (_req, res) => {
    try {
        const books = database_1.default.getAllBooks();
        res.json(books);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Get book info
app.get('/api/books/:bookId', (req, res) => {
    try {
        const book = database_1.default.getBook(req.params.bookId);
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
        const pagesPath = path_1.default.join(convertedDir, req.params.bookId, 'pages.json');
        // pages.jsonが存在しない場合のフォールバック
        if (!fs_1.default.existsSync(pagesPath)) {
            return res.json({ ...book, total: book.total_pages || 1, pages: [] });
        }
        const pagesInfo = JSON.parse(fs_1.default.readFileSync(pagesPath, 'utf8'));
        res.json({ ...book, ...pagesInfo });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Get book page content
app.get('/api/books/:bookId/page/:pageNum', (req, res) => {
    try {
        const { bookId, pageNum } = req.params;
        const pagePath = path_1.default.join(convertedDir, bookId, 'pages', `page-${pageNum}.html`);
        if (!fs_1.default.existsSync(pagePath)) {
            return res.status(404).json({ error: 'Page not found' });
        }
        const content = fs_1.default.readFileSync(pagePath, 'utf8');
        res.json({ content, pageNum: parseInt(pageNum) });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Get all pages content
app.get('/api/books/:bookId/all-pages', (req, res) => {
    try {
        const { bookId } = req.params;
        const pagesPath = path_1.default.join(convertedDir, bookId, 'pages.json');
        if (!fs_1.default.existsSync(pagesPath)) {
            return res.status(404).json({ error: 'Book not found' });
        }
        const pagesInfo = JSON.parse(fs_1.default.readFileSync(pagesPath, 'utf8'));
        const pages = [];
        for (let i = 1; i <= pagesInfo.total; i++) {
            const pagePath = path_1.default.join(convertedDir, bookId, 'pages', `page-${i}.html`);
            if (fs_1.default.existsSync(pagePath)) {
                const content = fs_1.default.readFileSync(pagePath, 'utf8');
                // Extract body content only
                const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                pages.push({
                    pageNum: i,
                    content: bodyMatch ? bodyMatch[1] : content
                });
            }
        }
        res.json({ pages, total: pagesInfo.total });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Get book TOC - extract headings from all pages
app.get('/api/books/:bookId/toc', (req, res) => {
    try {
        const { bookId } = req.params;
        const pagesPath = path_1.default.join(convertedDir, bookId, 'pages.json');
        if (!fs_1.default.existsSync(pagesPath)) {
            return res.json({ toc: [] });
        }
        const pagesInfo = JSON.parse(fs_1.default.readFileSync(pagesPath, 'utf8'));
        const toc = [];
        // Extract headings from each page
        for (let i = 1; i <= pagesInfo.total; i++) {
            const pagePath = path_1.default.join(convertedDir, bookId, 'pages', `page-${i}.html`);
            if (fs_1.default.existsSync(pagePath)) {
                const content = fs_1.default.readFileSync(pagePath, 'utf8');
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Bookmark APIs
app.get('/api/books/:bookId/bookmarks', (req, res) => {
    try {
        const bookmarks = database_1.default.getBookmarks(req.params.bookId);
        res.json(bookmarks);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/books/:bookId/bookmarks', (req, res) => {
    try {
        const { pageNum, note } = req.body;
        const bookmark = database_1.default.addBookmark(req.params.bookId, pageNum, note);
        res.json(bookmark);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.delete('/api/bookmarks/:bookmarkId', (req, res) => {
    try {
        database_1.default.deleteBookmark(req.params.bookmarkId);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Clips APIs (screenshot captures)
app.get('/api/books/:bookId/clips', (req, res) => {
    try {
        const clips = database_1.default.getClips(req.params.bookId);
        res.json(clips);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.get('/api/clips/:clipId', (req, res) => {
    try {
        const clip = database_1.default.getClip(req.params.clipId);
        if (!clip) {
            return res.status(404).json({ error: 'Clip not found' });
        }
        res.json(clip);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/books/:bookId/clips', (req, res) => {
    try {
        const { pageNum, imageData, note, position } = req.body;
        if (!imageData) {
            return res.status(400).json({ error: 'imageData is required' });
        }
        const clip = database_1.default.addClip(req.params.bookId, pageNum, imageData, note, position);
        res.json(clip);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.delete('/api/clips/:clipId', (req, res) => {
    try {
        database_1.default.deleteClip(req.params.clipId);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Reading progress
app.get('/api/books/:bookId/progress', (req, res) => {
    try {
        const progress = database_1.default.getProgress(req.params.bookId);
        res.json(progress || { currentPage: 1 });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/books/:bookId/progress', (req, res) => {
    try {
        const { currentPage } = req.body;
        database_1.default.saveProgress(req.params.bookId, currentPage);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Delete book
app.delete('/api/books/:bookId', (req, res) => {
    try {
        const { bookId } = req.params;
        // Delete from database
        database_1.default.deleteBook(bookId);
        // Delete files
        const bookDir = path_1.default.join(convertedDir, bookId);
        if (fs_1.default.existsSync(bookDir)) {
            fs_1.default.rmSync(bookDir, { recursive: true });
        }
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Update book info
app.patch('/api/books/:bookId', (req, res) => {
    try {
        const { bookId } = req.params;
        const { title, language } = req.body;
        const updated = database_1.default.updateBook(bookId, { title, language });
        if (!updated) {
            return res.status(404).json({ error: 'Book not found' });
        }
        res.json(updated);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Update PDF total pages (actual page count from PDF.js)
app.post('/api/books/:bookId/pdf-total-pages', (req, res) => {
    try {
        const { bookId } = req.params;
        const { totalPages } = req.body;
        if (typeof totalPages !== 'number' || totalPages < 1) {
            return res.status(400).json({ error: 'Invalid totalPages' });
        }
        database_1.default.updatePdfTotalPages(bookId, totalPages);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ===== Tags API =====
// Get all tags
app.get('/api/tags', (_req, res) => {
    try {
        const tags = database_1.default.getAllTags();
        res.json(tags);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Create tag
app.post('/api/tags', (req, res) => {
    try {
        const { name, color } = req.body;
        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: 'Tag name is required' });
        }
        const tag = database_1.default.createTag(name.trim(), color || '#667eea');
        res.json(tag);
    }
    catch (error) {
        const err = error;
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(400).json({ error: 'Tag already exists' });
        }
        res.status(500).json({ error: err.message });
    }
});
// Delete tag
app.delete('/api/tags/:tagId', (req, res) => {
    try {
        database_1.default.deleteTag(req.params.tagId);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Get tags for a book
app.get('/api/books/:bookId/tags', (req, res) => {
    try {
        const tags = database_1.default.getBookTags(req.params.bookId);
        res.json(tags);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Add tag to book
app.post('/api/books/:bookId/tags', (req, res) => {
    try {
        const { tagId } = req.body;
        if (!tagId) {
            return res.status(400).json({ error: 'tagId is required' });
        }
        database_1.default.addTagToBook(req.params.bookId, tagId);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Remove tag from book
app.delete('/api/books/:bookId/tags/:tagId', (req, res) => {
    try {
        database_1.default.removeTagFromBook(req.params.bookId, req.params.tagId);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Serve media files
app.get('/api/books/:bookId/media/*', (req, res) => {
    const mediaPath = path_1.default.join(convertedDir, req.params.bookId, 'media', req.params[0]);
    if (fs_1.default.existsSync(mediaPath)) {
        res.sendFile(mediaPath);
    }
    else {
        res.status(404).json({ error: 'Media not found' });
    }
});
// Upload custom cover image for a book
const coverStorage = multer_1.default.diskStorage({
    destination: (req, _file, cb) => {
        const bookDir = path_1.default.join(convertedDir, req.params.bookId);
        if (!fs_1.default.existsSync(bookDir)) {
            return cb(new Error('Book not found'), '');
        }
        cb(null, bookDir);
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        cb(null, `custom-cover${ext}`);
    }
});
const coverUpload = (0, multer_1.default)({
    storage: coverStorage,
    fileFilter: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
            cb(null, true);
        }
        else {
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
        const bookDir = path_1.default.join(convertedDir, bookId);
        // Remove old custom covers (different extensions)
        const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
        for (const ext of extensions) {
            const oldCover = path_1.default.join(bookDir, `custom-cover${ext}`);
            if (oldCover !== req.file.path && fs_1.default.existsSync(oldCover)) {
                fs_1.default.unlinkSync(oldCover);
            }
        }
        res.json({ success: true, message: 'Cover updated' });
    }
    catch (error) {
        console.error('Cover upload error:', error);
        res.status(500).json({ error: error.message });
    }
});
// Delete custom cover (revert to original)
app.delete('/api/books/:bookId/cover', (req, res) => {
    try {
        const { bookId } = req.params;
        const bookDir = path_1.default.join(convertedDir, bookId);
        // Remove custom covers
        const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
        let deleted = false;
        for (const ext of extensions) {
            const coverPath = path_1.default.join(bookDir, `custom-cover${ext}`);
            if (fs_1.default.existsSync(coverPath)) {
                fs_1.default.unlinkSync(coverPath);
                deleted = true;
            }
        }
        res.json({ success: true, deleted });
    }
    catch (error) {
        console.error('Cover delete error:', error);
        res.status(500).json({ error: error.message });
    }
});
// Get cover image for a book
app.get('/api/books/:bookId/cover', async (req, res) => {
    const { bookId } = req.params;
    const bookDir = path_1.default.join(convertedDir, bookId);
    const mediaDir = path_1.default.join(bookDir, 'media');
    // ブックディレクトリが存在しない場合
    if (!fs_1.default.existsSync(bookDir)) {
        return res.status(404).json({ error: 'Book directory not found' });
    }
    // PDFの場合、pages.jsonがないことで判定
    const pagesJsonPath = path_1.default.join(bookDir, 'pages.json');
    // PDFファイルは document.pdf として保存される
    const pdfPath = path_1.default.join(bookDir, 'document.pdf');
    // PDFの場合は1ページ目のサムネイルを生成
    if (!fs_1.default.existsSync(pagesJsonPath) && fs_1.default.existsSync(pdfPath)) {
        // カスタムカバーがあればそちらを優先
        const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
        for (const ext of extensions) {
            const customCover = path_1.default.join(bookDir, `custom-cover${ext}`);
            if (fs_1.default.existsSync(customCover)) {
                return res.sendFile(customCover);
            }
        }
        // PDFサムネイルがキャッシュされていればそれを返す
        const thumbnailPath = path_1.default.join(bookDir, 'pdf-thumbnail.png');
        if (fs_1.default.existsSync(thumbnailPath)) {
            return res.sendFile(thumbnailPath);
        }
        // pdftoppmでサムネイル生成を試みる
        try {
            const thumbPrefix = path_1.default.join(bookDir, 'pdf-thumb');
            (0, child_process_1.execSync)(`pdftoppm -png -f 1 -l 1 -scale-to 400 "${pdfPath}" "${thumbPrefix}"`, { timeout: 30000 });
            // pdftoppmは pdf-thumb-1.png または pdf-thumb-01.png を生成する
            const possibleFiles = [
                `${thumbPrefix}-1.png`,
                `${thumbPrefix}-01.png`,
                `${thumbPrefix}-001.png`
            ];
            for (const thumbFile of possibleFiles) {
                if (fs_1.default.existsSync(thumbFile)) {
                    fs_1.default.renameSync(thumbFile, thumbnailPath);
                    console.log(`PDF thumbnail generated: ${thumbnailPath}`);
                    return res.sendFile(thumbnailPath);
                }
            }
            // ディレクトリ内のpdf-thumb*.pngを探す
            const files = fs_1.default.readdirSync(bookDir);
            const thumbMatch = files.find(f => f.startsWith('pdf-thumb') && f.endsWith('.png'));
            if (thumbMatch) {
                const matchPath = path_1.default.join(bookDir, thumbMatch);
                fs_1.default.renameSync(matchPath, thumbnailPath);
                console.log(`PDF thumbnail generated from ${thumbMatch}: ${thumbnailPath}`);
                return res.sendFile(thumbnailPath);
            }
            console.log('pdftoppm ran but no output file found');
        }
        catch (e) {
            console.error('pdftoppm error:', e.message);
        }
        return res.status(404).json({ error: 'No cover found for PDF' });
    }
    // First check for custom cover
    const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    for (const ext of extensions) {
        const customCover = path_1.default.join(bookDir, `custom-cover${ext}`);
        if (fs_1.default.existsSync(customCover)) {
            return res.sendFile(customCover);
        }
    }
    if (!fs_1.default.existsSync(mediaDir)) {
        return res.status(404).json({ error: 'No media found' });
    }
    // Find cover image - check common patterns
    const findCover = (dir) => {
        const items = fs_1.default.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
            const fullPath = path_1.default.join(dir, item.name);
            if (item.isDirectory()) {
                const found = findCover(fullPath);
                if (found)
                    return found;
            }
            else if (item.isFile()) {
                const ext = path_1.default.extname(item.name).toLowerCase();
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
            const items = fs_1.default.readdirSync(dir, { withFileTypes: true });
            for (const item of items) {
                const fullPath = path_1.default.join(dir, item.name);
                if (item.isDirectory()) {
                    const found = findFirstImage(fullPath);
                    if (found)
                        return found;
                }
                else if (item.isFile()) {
                    const ext = path_1.default.extname(item.name).toLowerCase();
                    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
                        return fullPath;
                    }
                }
            }
            return null;
        };
        coverPath = findFirstImage(mediaDir);
    }
    if (coverPath && fs_1.default.existsSync(coverPath)) {
        res.sendFile(coverPath);
    }
    else {
        res.status(404).json({ error: 'No cover found' });
    }
});
// Serve React app for all other routes in production
if (process.env.NODE_ENV === 'production') {
    app.get('*', (_req, res) => {
        res.sendFile(path_1.default.join(ROOT_DIR, 'client/dist/index.html'));
    });
}
app.listen(PORT, () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});
exports.default = app;
//# sourceMappingURL=index.js.map