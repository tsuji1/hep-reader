import * as cheerio from 'cheerio';
import { execSync } from 'child_process';
import cors from 'cors';
import express, { Request, Response } from 'express';
import fs from 'fs';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import db from './database';
import { isValidHttpUrl, normalizeClassSelector, normalizeUrl, resolveUrl, shouldIgnorePath } from './multipage-utils';
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

// ===== AI Helper Functions =====
interface AiResponse {
  response: string;
}

async function callAi(prompt: string): Promise<string | null> {
  // Try to get any configured AI provider
  const settings = db.getAiSettings();
  if (settings.length === 0) return null;

  // Prefer gemini > claude > openai (gemini is usually faster)
  const providerOrder = ['gemini', 'claude', 'openai'];
  const setting = providerOrder
    .map(p => settings.find(s => s.provider === p))
    .find(s => s && s.api_key);

  if (!setting) return null;

  const { provider, api_key: apiKey, model } = setting;

  try {
    if (provider === 'openai') {
      const modelName = model || 'gpt-4o-mini';
      const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500
        })
      });
      const data = await apiRes.json() as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content || null;
    } else if (provider === 'claude') {
      const modelName = model || 'claude-sonnet-4-20250514';
      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: modelName,
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const data = await apiRes.json() as { content?: { text?: string }[] };
      return data.content?.[0]?.text || null;
    } else if (provider === 'gemini') {
      const modelName = model || 'gemini-2.0-flash';
      const apiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        }
      );
      const data = await apiRes.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    }
  } catch (error) {
    console.error('AI call error:', error);
  }
  return null;
}

// Auto-suggest tags based on content
async function suggestTags(title: string, content: string): Promise<string[]> {
  const allTags = db.getAllTags();
  if (allTags.length === 0) return [];

  const tagNames = allTags.map(t => t.name).join(', ');
  const prompt = `以下の本/記事のタイトルと内容から、最も適切なタグを選んでください。
タグは必ず以下のリストから選び、カンマ区切りで返してください（最大3つ）。
該当するタグがなければ空で返してください。

利用可能なタグ: ${tagNames}

タイトル: ${title}
内容（先頭500文字）: ${content.substring(0, 500)}

選んだタグ（カンマ区切り）:`;

  const response = await callAi(prompt);
  if (!response) return [];

  // Parse response to extract tag names
  const suggestedNames = response
    .split(/[,、]/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  // Return only valid tag IDs
  return allTags
    .filter(t => suggestedNames.some(name =>
      t.name.toLowerCase() === name.toLowerCase() ||
      name.toLowerCase().includes(t.name.toLowerCase())
    ))
    .map(t => t.id);
}

// Generate clip description
async function generateClipDescription(imageContext: string, bookTitle: string): Promise<string> {
  const prompt = `以下の本からキャプチャした画像の簡潔な説明を日本語で1-2文で作成してください。
本のタイトル: ${bookTitle}
画像の文脈/周辺テキスト: ${imageContext.substring(0, 300)}

説明:`;

  const response = await callAi(prompt);
  return response || '';
}
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

      // Auto-suggest tags (async, don't wait)
      suggestTags(bookTitle, originalFilename).then(tagIds => {
        tagIds.forEach(tagId => db.addTagToBook(bookId, tagId));
      }).catch(e => console.error('Auto-tag error:', e));

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

    // Auto-suggest tags based on content (async, don't wait)
    suggestTags(bookTitle, htmlContent).then(tagIds => {
      tagIds.forEach(tagId => db.addTagToBook(bookId, tagId));
    }).catch(e => console.error('Auto-tag error:', e));

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

  // Remove unwanted elements (common across blog platforms)
  $([
    'script', 'style', 'nav', 'header', 'footer', 'aside', 'iframe', 'noscript',
    '.ads', '.advertisement', '.sidebar', '.menu', '.navigation',
    '.comment', '.comments', '#comments', '.social-share', '.share-buttons', '.related-posts',
    // Blog platform common: footers, modules, subscribe buttons
    '.hatena-module', '.hatena-urllist', '#box2', '.entry-footer-section', '.entry-footer-modules',
    '.hatena-star-container', '.hatena-bookmark-button-frame', '.subscribe-button', '.reader-button',
    '.page-footer', '.ad-label', '.ad-content', '.google-afc-user-container', '.sentry-error-embed',
    '.entry-reactions', '.customized-footer', '.hatena-asin-detail'
  ].join(', ')).remove();

  // Find main content - try specific selectors first, then generic ones
  // More specific selectors (with multiple classes) take priority to avoid matching wrong elements
  const contentSelectors = [
    '.entry-content.hatenablog-entry',  // Hatena Blog actual content
    '.hatenablog-entry',
    '.entry.hentry .entry-content',     // Generic blog entry
    '.post-content',
    '.article-content',
    'article',
    'main',
    '[role="main"]',
    '.entry-content',
    '.content',
    '#content',
    'body'
  ];

  let $content = $('');
  for (const selector of contentSelectors) {
    $content = $(selector).first();
    // Skip if empty or too short (likely wrong element like ad container)
    if ($content.length > 0 && $content.text().trim().length > 100) {
      break;
    }
  }

  // Fallback to body if nothing found
  if ($content.length === 0 || $content.text().trim().length < 100) {
    $content = $('body');
  }

  // Process images - collect and update src
  $content.find('img').each((_, img) => {
    const $img = $(img);
    // Check multiple sources for lazy-loaded images
    let src = $img.attr('src') ||
      $img.attr('data-src') ||
      $img.attr('data-lazy-src') ||
      $img.attr('data-original');

    // Skip tiny placeholder images (often 1x1 pixels for tracking)
    const width = parseInt($img.attr('width') || '0', 10);
    const height = parseInt($img.attr('height') || '0', 10);
    if ((width > 0 && width < 10) || (height > 0 && height < 10)) {
      $img.remove();
      return;
    }

    if (src) {
      // Skip data URLs and invalid sources
      if (src.startsWith('data:') || src === '' || src === '#') {
        $img.remove();
        return;
      }

      try {
        const absoluteUrl = new URL(src, baseUrl).href;
        images.push(absoluteUrl);
        $img.attr('src', `media/${images.length - 1}.img`);
        $img.removeAttr('data-src');
        $img.removeAttr('data-lazy-src');
        $img.removeAttr('data-original');
        $img.removeAttr('srcset');
        $img.removeAttr('loading');
      } catch {
        // Invalid URL, remove image
        $img.remove();
      }
    }
  });

  // Clean up attributes - keep semantic, language, and code-related attributes
  $content.find('*').each((_, el) => {
    const $el = $(el);
    const tagName = el.type === 'tag' ? (el as cheerio.TagElement).name?.toLowerCase() : '';

    // Keep more attributes for code blocks (important for syntax highlighting)
    const isCodeElement = tagName === 'code' || tagName === 'pre' || $el.closest('pre').length > 0;

    // Essential attributes for different element types
    const allowedAttrs = ['src', 'href', 'alt', 'title', 'lang', 'dir', 'cite', 'datetime'];

    // Always keep class for styling and language detection
    if (isCodeElement) {
      // For code elements, keep class for syntax highlighting
      allowedAttrs.push('class', 'data-lang');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attrs = Object.keys((el as any).attribs || {});
    attrs.forEach(attr => {
      if (!allowedAttrs.includes(attr)) {
        $el.removeAttr(attr);
      }
    });
  });

  // Remove empty elements (but be careful with code blocks)
  $content.find('div, span, p').each((_, el) => {
    const $el = $(el);
    // Don't remove elements that might be code-related or contain code blocks
    if ($el.closest('pre').length > 0 || $el.find('pre').length > 0 || $el.find('code').length > 0) {
      return;
    }
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

  // Check if there are any h1 or h2 headings
  const h1Count = $('h1').length;
  const h2Count = $('h2').length;

  if (h1Count === 0 && h2Count === 0) {
    // No headings, return as single page
    return [modifiedContent];
  }

  // Split by h1 and h2 tags
  const headingRegex = /(<h[12][^>]*>)/gi;
  const parts = modifiedContent.split(headingRegex);

  if (parts.length <= 1) {
    return [modifiedContent];
  }

  const sections: string[] = [];
  let currentSection = '';

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part.match(/^<h[12][^>]*>$/i)) {
      // This is an h1 or h2 opening tag
      // Save previous section if it has meaningful content
      const trimmedSection = currentSection.replace(/<[^>]*>/g, '').trim();
      if (trimmedSection.length > 20) {
        sections.push(currentSection);
      }
      // Start new section with this heading tag
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

// FreshRSS integration - receive article from FreshRSS share button
// FreshRSS Share URL format: http://your-server:10300/api/freshrss/share?url=~url~&title=~title~
app.get('/api/freshrss/share', async (req: Request, res: Response) => {
  try {
    const { url, title } = req.query;

    if (!url || typeof url !== 'string') {
      return res.status(400).send(`
        <html>
        <head><meta charset="UTF-8"><title>Error</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1>❌ URLが必要です</h1>
          <p>FreshRSSの共有設定を確認してください</p>
        </body>
        </html>
      `);
    }

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      return res.status(400).send(`
        <html>
        <head><meta charset="UTF-8"><title>Error</title></head>
        <body style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h1>❌ 無効なURLです</h1>
          <p>${url}</p>
        </body>
        </html>
      `);
    }

    // Show processing page first
    const processingHtml = `
      <html>
      <head>
        <meta charset="UTF-8">
        <title>保存中... | EPUB Viewer</title>
        <style>
          body { font-family: sans-serif; padding: 40px; text-align: center; background: #f5f5f5; }
          .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .spinner { width: 50px; height: 50px; border: 4px solid #e2e8f0; border-top-color: #667eea; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px; }
          @keyframes spin { to { transform: rotate(360deg); } }
          h1 { color: #333; margin-bottom: 10px; }
          p { color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="spinner"></div>
          <h1>📚 記事を保存中...</h1>
          <p>${title || url}</p>
        </div>
        <script>
          fetch('/api/save-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: '${url.replace(/'/g, "\\'")}' })
          })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              document.body.innerHTML = \`
                <div class="container" style="max-width: 600px; margin: 40px auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center;">
                  <h1 style="color: #22c55e;">✅ 保存しました！</h1>
                  <p style="color: #333; font-size: 1.1em; margin: 20px 0;">\${data.title}</p>
                  <p style="color: #666;">全 \${data.totalPages} ページ</p>
                  <div style="margin-top: 30px;">
                    <a href="/reader/\${data.bookId}" style="display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; margin-right: 10px;">📖 読む</a>
                    <a href="/" style="display: inline-block; padding: 12px 24px; background: #e2e8f0; color: #333; text-decoration: none; border-radius: 8px;">📚 ライブラリ</a>
                  </div>
                  <p style="margin-top: 30px; color: #999; font-size: 0.9em;">このウィンドウは閉じても大丈夫です</p>
                </div>
              \`;
            } else {
              throw new Error(data.error || 'Failed to save');
            }
          })
          .catch(err => {
            document.body.innerHTML = \`
              <div class="container" style="max-width: 600px; margin: 40px auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center;">
                <h1 style="color: #ef4444;">❌ 保存に失敗しました</h1>
                <p style="color: #666;">\${err.message}</p>
                <a href="/" style="display: inline-block; margin-top: 20px; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 8px;">ライブラリへ</a>
              </div>
            \`;
          });
        </script>
      </body>
      </html>
    `;

    res.send(processingHtml);
  } catch (error) {
    console.error('FreshRSS share error:', error);
    res.status(500).send(`
      <html>
      <head><meta charset="UTF-8"><title>Error</title></head>
      <body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h1>❌ エラーが発生しました</h1>
        <p>${(error as Error).message}</p>
      </body>
      </html>
    `);
  }
});

// Multi-page crawl and save
app.post('/api/save-multipage-url', async (req: Request, res: Response) => {
  try {
    const { url, linkClass, ignorePaths = [], maxPages = 50 } = req.body as {
      url: string;
      linkClass: string;
      ignorePaths?: string[];
      maxPages?: number;
    };

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' });
    }

    if (!linkClass || typeof linkClass !== 'string') {
      return res.status(400).json({ error: 'linkClass is required (e.g., "next-page")' });
    }

    // Validate URL using helper function
    if (!isValidHttpUrl(url)) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const visitedUrls = new Set<string>();
    const allPages: Array<{ url: string; content: string; images: string[]; title: string }> = [];
    let currentUrl = url;

    console.log(`Starting multi-page crawl from: ${url}`);
    console.log(`Link class: ${linkClass}`);
    console.log(`Ignore paths: ${ignorePaths.join(', ')}`);

    // Crawl pages
    while (currentUrl && allPages.length < maxPages) {
      // Normalize URL using helper function
      const normalizedUrl = normalizeUrl(currentUrl);

      // Skip if already visited
      if (visitedUrls.has(normalizedUrl)) {
        console.log(`Already visited: ${normalizedUrl}`);
        break;
      }

      // Check if URL should be ignored using helper function
      const urlPath = new URL(normalizedUrl).pathname;
      if (shouldIgnorePath(urlPath, ignorePaths)) {
        console.log(`Ignoring path: ${normalizedUrl}`);
        break;
      }

      visitedUrls.add(normalizedUrl);
      console.log(`Fetching page ${allPages.length + 1}: ${normalizedUrl}`);

      try {
        const response = await fetchWithTimeout(normalizedUrl);
        if (!response.ok) {
          console.log(`Failed to fetch: ${response.status}`);
          break;
        }

        const html = await response.text();
        const metadata = extractMetadata(html, normalizedUrl);
        const { content, images } = extractArticleContent(html, normalizedUrl);

        allPages.push({
          url: normalizedUrl,
          content,
          images,
          title: metadata.title
        });

        // Find next page link
        const $ = cheerio.load(html);
        let nextUrl: string | null = null;

        // Look for the link with the specified class using helper function
        const classSelector = normalizeClassSelector(linkClass);

        const nextLink = $(`a${classSelector}`).first();
        if (nextLink.length > 0) {
          const href = nextLink.attr('href');
          if (href) {
            // Use helper function to resolve URL
            nextUrl = resolveUrl(href, normalizedUrl);
            if (nextUrl) {
              console.log(`Found next page: ${nextUrl}`);
            } else {
              console.log(`Invalid next URL: ${href}`);
            }
          }
        }

        // Also try rel="next" as a fallback
        if (!nextUrl) {
          const relNext = $('a[rel="next"]').first();
          if (relNext.length > 0) {
            const href = relNext.attr('href');
            if (href) {
              // Use helper function to resolve URL
              nextUrl = resolveUrl(href, normalizedUrl);
              if (nextUrl) {
                console.log(`Found next page via rel="next": ${nextUrl}`);
              } else {
                console.log(`Invalid next URL: ${href}`);
              }
            }
          }
        }

        currentUrl = nextUrl || '';

        // Small delay to be polite to servers
        if (currentUrl) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (e) {
        console.error(`Error fetching ${normalizedUrl}:`, (e as Error).message);
        break;
      }
    }

    if (allPages.length === 0) {
      return res.status(400).json({ error: 'No pages could be fetched' });
    }

    console.log(`Crawled ${allPages.length} pages`);

    // Create book directory
    const bookId = uuidv4();
    const bookDir = path.join(convertedDir, bookId);
    const mediaDir = path.join(bookDir, 'media');
    const pagesDir = path.join(bookDir, 'pages');

    fs.mkdirSync(bookDir, { recursive: true });
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.mkdirSync(pagesDir, { recursive: true });

    // Collect all images and download them
    let imageIndex = 0;
    const imageMap = new Map<string, string>(); // original URL -> local path

    for (const page of allPages) {
      for (const imgUrl of page.images) {
        if (!imageMap.has(imgUrl)) {
          try {
            const ext = path.extname(new URL(imgUrl).pathname) || '.jpg';
            const localPath = `media/${imageIndex}${ext}`;
            const imgPath = path.join(bookDir, localPath);
            await downloadImage(imgUrl, imgPath);
            imageMap.set(imgUrl, localPath);
            imageIndex++;
          } catch (e) {
            console.log(`Failed to download image: ${imgUrl}`);
          }
        }
      }
    }

    // Create HTML pages
    const pageFiles: string[] = [];
    const firstPage = allPages[0];
    const bookTitle = firstPage.title;

    // Custom styles (same as save-url)
    const customStyles = `
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
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
          padding: 0;
          overflow-x: auto;
          border-radius: 5px;
          margin: 1em 0;
        }
        pre code { 
          display: block;
          padding: 15px;
          font-family: 'Consolas', 'Monaco', monospace;
          font-size: 0.9em;
        }
        code { 
          background: #f4f4f4; 
          padding: 2px 6px;
          border-radius: 3px;
          font-family: 'Consolas', 'Monaco', monospace;
        }
        h1, h2, h3 { color: #2c3e50; }
        a { color: #3498db; }
        blockquote { border-left: 4px solid #3498db; margin: 1em 0; padding-left: 1em; color: #666; }
        .page-source { 
          margin-top: 20px;
          padding: 10px;
          background: #f0f0f0;
          border-radius: 5px;
          font-size: 0.8em;
          color: #666;
        }
      </style>
    `;

    const highlightScript = `
      <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
      <script>
        document.addEventListener('DOMContentLoaded', function() {
          hljs.highlightAll();
        });
      </script>
    `;

    for (let i = 0; i < allPages.length; i++) {
      const page = allPages[i];
      const pageNum = i + 1;

      // Fix image paths in content
      let fixedContent = page.content;
      for (const [originalUrl, localPath] of imageMap.entries()) {
        // Replace all variations of the image reference
        const patterns = [
          new RegExp(`src="[^"]*${imageIndex}\\.img"`, 'g'),
        ];

        // Simple approach: replace media/INDEX.img with actual local path
        for (let j = 0; j < page.images.length; j++) {
          const imgUrl = page.images[j];
          const localImgPath = imageMap.get(imgUrl);
          if (localImgPath) {
            fixedContent = fixedContent.replace(
              new RegExp(`media/${j}\\.img`, 'g'),
              `../${localImgPath}`
            );
          }
        }
      }

      const pageHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${page.title} - Page ${pageNum}</title>
  ${customStyles}
</head>
<body>
  <h1>${page.title}</h1>
  ${fixedContent}
  <div class="page-source">
    Page ${pageNum} of ${allPages.length} | Source: <a href="${page.url}" target="_blank">${page.url}</a>
  </div>
  ${highlightScript}
</body>
</html>`;

      const pageFile = `page-${pageNum}.html`;
      fs.writeFileSync(path.join(pagesDir, pageFile), pageHtml);
      pageFiles.push(pageFile);
    }

    // Save pages index
    fs.writeFileSync(
      path.join(bookDir, 'pages.json'),
      JSON.stringify({ total: pageFiles.length, pages: pageFiles })
    );

    // Save metadata
    fs.writeFileSync(
      path.join(bookDir, 'metadata.json'),
      JSON.stringify({
        title: bookTitle,
        sourceUrl: url,
        crawledPages: allPages.map(p => p.url),
        linkClass,
        ignorePaths,
        savedAt: new Date().toISOString()
      })
    );

    // Save to database
    db.addWebsiteBook(bookId, bookTitle, url, pageFiles.length);

    // Auto-suggest tags
    const webTag = db.getAllTags().find(t => t.name === 'web');
    if (webTag) {
      db.addTagToBook(bookId, webTag.id);
    }

    res.json({
      success: true,
      bookId,
      title: bookTitle,
      bookType: 'website',
      totalPages: pageFiles.length,
      crawledUrls: allPages.map(p => p.url)
    });
  } catch (error) {
    console.error('Save multipage URL error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

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

    // Create page HTML template with highlight.js
    const customStyles = `
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
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
          padding: 0;
          overflow-x: auto;
          border-radius: 5px;
          margin: 1em 0;
        }
        pre code { 
          display: block;
          padding: 15px;
          font-family: 'Consolas', 'Monaco', monospace;
          font-size: 0.9em;
        }
        code { 
          background: #f4f4f4; 
          padding: 2px 6px;
          border-radius: 3px;
          font-family: 'Consolas', 'Monaco', monospace;
        }
        h1, h2, h3 { color: #2c3e50; }
        a { color: #3498db; }
        blockquote { border-left: 4px solid #3498db; margin: 1em 0; padding-left: 1em; color: #666; }
      </style>
    `;

    const highlightScript = `
      <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
      <script>
        document.addEventListener('DOMContentLoaded', function() {
          hljs.highlightAll();
        });
      </script>
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
  ${highlightScript}
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

    // Auto-suggest tags based on content (async, don't wait)
    // Add 'web' tag automatically for websites
    const webTag = db.getAllTags().find(t => t.name === 'web');
    if (webTag) {
      db.addTagToBook(bookId, webTag.id);
    }
    suggestTags(metadata.title, fixedContent).then(tagIds => {
      tagIds.forEach(tagId => db.addTagToBook(bookId, tagId));
    }).catch(e => console.error('Auto-tag error:', e));

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

// Save translated page content (翻訳されたページを保存)
app.post('/api/books/:bookId/page/:pageNum/save-translation', (req: Request, res: Response) => {
  try {
    const { bookId, pageNum } = req.params;
    const { content } = req.body as { content: string };

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Content is required' });
    }

    const pagesDir = path.join(convertedDir, bookId, 'pages');
    const pagePath = path.join(pagesDir, `page-${pageNum}.html`);

    if (!fs.existsSync(pagePath)) {
      return res.status(404).json({ error: 'Page not found' });
    }

    // バックアップを作成（初回のみ）
    const backupPath = path.join(pagesDir, `page-${pageNum}.original.html`);
    if (!fs.existsSync(backupPath)) {
      const originalContent = fs.readFileSync(pagePath, 'utf8');
      fs.writeFileSync(backupPath, originalContent);
    }

    // 翻訳されたコンテンツを保存
    fs.writeFileSync(pagePath, content);

    console.log(`Saved translated page: ${bookId}/page-${pageNum}`);
    res.json({ success: true, message: 'Translation saved' });
  } catch (error) {
    console.error('Save translation error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Restore original page content (元のページを復元)
app.post('/api/books/:bookId/page/:pageNum/restore-original', (req: Request, res: Response) => {
  try {
    const { bookId, pageNum } = req.params;

    const pagesDir = path.join(convertedDir, bookId, 'pages');
    const pagePath = path.join(pagesDir, `page-${pageNum}.html`);
    const backupPath = path.join(pagesDir, `page-${pageNum}.original.html`);

    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ error: 'Original backup not found' });
    }

    // バックアップから復元
    const originalContent = fs.readFileSync(backupPath, 'utf8');
    fs.writeFileSync(pagePath, originalContent);

    console.log(`Restored original page: ${bookId}/page-${pageNum}`);
    res.json({ success: true, message: 'Original restored' });
  } catch (error) {
    console.error('Restore original error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get translation status for all pages (翻訳状態を取得)
app.get('/api/books/:bookId/translation-status', (req: Request, res: Response) => {
  try {
    const { bookId } = req.params;
    const pagesDir = path.join(convertedDir, bookId, 'pages');

    if (!fs.existsSync(pagesDir)) {
      return res.status(404).json({ error: 'Book pages not found' });
    }

    // .original.html ファイルを探して翻訳済みページを特定
    const files = fs.readdirSync(pagesDir);
    const translatedPages: number[] = [];

    for (const file of files) {
      const match = file.match(/^page-(\d+)\.original\.html$/);
      if (match) {
        translatedPages.push(parseInt(match[1], 10));
      }
    }

    res.json({
      translatedPages: translatedPages.sort((a, b) => a - b),
      totalTranslated: translatedPages.length
    });
  } catch (error) {
    console.error('Get translation status error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Restore all translated pages to original (全ページを元に戻す)
app.post('/api/books/:bookId/restore-all-translations', (req: Request, res: Response) => {
  try {
    const { bookId } = req.params;
    const pagesDir = path.join(convertedDir, bookId, 'pages');

    if (!fs.existsSync(pagesDir)) {
      return res.status(404).json({ error: 'Book pages not found' });
    }

    const files = fs.readdirSync(pagesDir);
    let restoredCount = 0;

    for (const file of files) {
      const match = file.match(/^page-(\d+)\.original\.html$/);
      if (match) {
        const pageNum = match[1];
        const backupPath = path.join(pagesDir, file);
        const pagePath = path.join(pagesDir, `page-${pageNum}.html`);

        const originalContent = fs.readFileSync(backupPath, 'utf8');
        fs.writeFileSync(pagePath, originalContent);
        // バックアップファイルを削除
        fs.unlinkSync(backupPath);
        restoredCount++;
      }
    }

    console.log(`Restored ${restoredCount} pages for book: ${bookId}`);
    res.json({ success: true, restoredCount });
  } catch (error) {
    console.error('Restore all translations error:', error);
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

// ===== Notes API (差し込みエディタ) =====

// Get notes for a book
app.get('/api/books/:bookId/notes', (req: Request, res: Response) => {
  try {
    const notes = db.getNotes(req.params.bookId);
    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Add note to a book
app.post('/api/books/:bookId/notes', (req: Request, res: Response) => {
  try {
    const { pageNum, content, position } = req.body as {
      pageNum: number;
      content?: string;
      position?: number;
    };
    if (typeof pageNum !== 'number') {
      return res.status(400).json({ error: 'pageNum is required' });
    }
    const note = db.addNote(req.params.bookId, pageNum, content || '', position || 0);
    res.json(note);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Update note
app.put('/api/notes/:noteId', (req: Request, res: Response) => {
  try {
    const { content } = req.body as { content: string };
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content is required' });
    }
    const note = db.updateNote(req.params.noteId, content);
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json(note);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Delete note
app.delete('/api/notes/:noteId', (req: Request, res: Response) => {
  try {
    db.deleteNote(req.params.noteId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Save edited page content (EPUB/Web編集)
app.post('/api/books/:bookId/page/:pageNum/save-edit', (req: Request, res: Response) => {
  try {
    const { bookId, pageNum } = req.params;
    const { content } = req.body as { content: string };

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Content is required' });
    }

    const pagesDir = path.join(convertedDir, bookId, 'pages');
    const pagePath = path.join(pagesDir, `page-${pageNum}.html`);

    if (!fs.existsSync(pagePath)) {
      return res.status(404).json({ error: 'Page not found' });
    }

    // 元のHTMLを読み込んでbody部分を置換
    const originalHtml = fs.readFileSync(pagePath, 'utf8');

    // head部分を抽出
    const headMatch = originalHtml.match(/<head[^>]*>[\s\S]*?<\/head>/i);
    const headContent = headMatch ? headMatch[0] : '<head><meta charset="UTF-8"></head>';

    // 新しいHTMLを構築
    const newHtml = `<!DOCTYPE html>
<html>
${headContent}
<body>
  ${content}
</body>
</html>`;

    // バックアップを作成（初回のみ）
    const backupPath = path.join(pagesDir, `page-${pageNum}.edit-backup.html`);
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, originalHtml);
    }

    // 編集されたコンテンツを保存
    fs.writeFileSync(pagePath, newHtml);

    console.log(`Saved edited page: ${bookId}/page-${pageNum}`);
    res.json({ success: true, message: 'Edit saved' });
  } catch (error) {
    console.error('Save edit error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Generate clip description using AI
app.post('/api/ai/generate-clip-description', async (req: Request, res: Response) => {
  try {
    const { bookTitle, pageContent } = req.body as {
      bookTitle: string;
      pageContent: string;
    };

    if (!bookTitle || !pageContent) {
      return res.status(400).json({ error: 'bookTitle and pageContent are required' });
    }

    const description = await generateClipDescription(pageContent, bookTitle);
    res.json({ description });
  } catch (error) {
    console.error('Generate description error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Auto-tag all existing books
app.post('/api/ai/auto-tag-all', async (req: Request, res: Response) => {
  try {
    const { force } = req.body as { force?: boolean };
    const books = db.getAllBooks();
    const results: { bookId: string; title: string; tags: string[] }[] = [];

    for (const book of books) {
      // Skip if book already has tags (unless force is true)
      const existingTags = db.getBookTags(book.id);
      if (!force && existingTags.length > 0) {
        results.push({ bookId: book.id, title: book.title, tags: existingTags.map(t => t.name) });
        continue;
      }

      // Get content for tag suggestion
      let content = book.title;
      const bookDir = path.join(convertedDir, book.id);
      const pagesDir = path.join(bookDir, 'pages');

      // Try to read first page content
      if (fs.existsSync(path.join(pagesDir, 'page-1.html'))) {
        try {
          const pageContent = fs.readFileSync(path.join(pagesDir, 'page-1.html'), 'utf8');
          content = pageContent.substring(0, 1000);
        } catch (e) {
          // Ignore read errors
        }
      }

      // Suggest and add tags
      const tagIds = await suggestTags(book.title, content);
      const addedTags: string[] = [];
      for (const tagId of tagIds) {
        db.addTagToBook(book.id, tagId);
        const tag = db.getAllTags().find(t => t.id === tagId);
        if (tag) addedTags.push(tag.name);
      }

      results.push({ bookId: book.id, title: book.title, tags: addedTags });

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('Auto-tag all error:', error);
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
    const { title, language, ai_context } = req.body;

    const updated = db.updateBook(bookId, { title, language, ai_context });
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
    // Check if it's the protected "積読" tag
    const tags = db.getAllTags();
    const tagToDelete = tags.find(t => t.id === req.params.tagId);
    if (tagToDelete && tagToDelete.name === '積読') {
      return res.status(400).json({ error: '積読タグは削除できません' });
    }
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
