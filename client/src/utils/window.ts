import type { Clip, ImageInfo } from '../types'

/**
 * 画像を新しいウィンドウで開く
 * EPUBの画像やPDFのクリップ画像を別ウィンドウで表示する共通関数
 */
export function openImageInNewWindow(image: ImageInfo): void {
  const newWindow = window.open('', '_blank', 'width=800,height=600,resizable=yes,scrollbars=yes')
  if (!newWindow) {
    alert('ポップアップがブロックされました。ポップアップを許可してください。')
    return
  }

  const title = image.alt || '画像'
  const pageInfo = image.pageNum ? `<div class="page-info">ページ ${image.pageNum}</div>` : ''

  newWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          background: #1a1a2e;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          overflow: auto;
        }
        .image-container {
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: zoom-in;
          transition: transform 0.3s ease;
        }
        .image-container.zoomed {
          cursor: zoom-out;
        }
        .image-container.zoomed img {
          max-width: none;
          max-height: none;
        }
        img {
          max-width: 100%;
          max-height: calc(100vh - 80px);
          object-fit: contain;
          border-radius: 8px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          transition: transform 0.3s ease;
        }
        .page-info {
          color: #fff;
          margin-top: 15px;
          font-size: 14px;
          opacity: 0.8;
        }
        .zoom-hint {
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          color: rgba(255,255,255,0.6);
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <div class="image-container" onclick="toggleZoom(this)">
        <img src="${image.src}" alt="${title}" />
      </div>
      ${pageInfo}
      <div class="zoom-hint">クリックで拡大/縮小</div>
      <script>
        let zoomLevel = 1;
        function toggleZoom(container) {
          const img = container.querySelector('img');
          if (container.classList.contains('zoomed')) {
            container.classList.remove('zoomed');
            img.style.transform = 'scale(1)';
            zoomLevel = 1;
          } else {
            container.classList.add('zoomed');
            img.style.transform = 'scale(2)';
            zoomLevel = 2;
          }
        }
        document.addEventListener('wheel', function(e) {
          if (e.ctrlKey) {
            e.preventDefault();
            const container = document.querySelector('.image-container');
            const img = container.querySelector('img');
            if (e.deltaY < 0) {
              zoomLevel = Math.min(5, zoomLevel + 0.25);
            } else {
              zoomLevel = Math.max(0.5, zoomLevel - 0.25);
            }
            img.style.transform = 'scale(' + zoomLevel + ')';
            if (zoomLevel > 1) {
              container.classList.add('zoomed');
            } else {
              container.classList.remove('zoomed');
            }
          }
        }, { passive: false });
      </script>
    </body>
    </html>
  `)
  newWindow.document.close()
}

/**
 * クリップ画像を新しいウィンドウで開く
 * PDFのクリップ用の専用関数
 */
export function openClipInNewWindow(clip: Clip): void {
  const newWindow = window.open('', '_blank', 'width=600,height=500,resizable=yes,scrollbars=yes')
  if (!newWindow) {
    alert('ポップアップがブロックされました。ポップアップを許可してください。')
    return
  }

  newWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${clip.note || 'クリップ画像'} - p.${clip.page_num}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          background: #1a1a2e;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          overflow: auto;
        }
        .image-container {
          cursor: zoom-in;
        }
        .image-container.zoomed {
          cursor: zoom-out;
        }
        .image-container.zoomed img {
          max-width: none;
        }
        img {
          max-width: 100%;
          height: auto;
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          transition: transform 0.3s ease;
        }
        .info {
          color: #fff;
          margin-top: 15px;
          text-align: center;
        }
        .note {
          color: #aaa;
          font-size: 14px;
          margin-top: 8px;
        }
        .zoom-hint {
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          color: rgba(255,255,255,0.6);
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <div class="image-container" onclick="toggleZoom(this)">
        <img src="${clip.image_data}" alt="クリップ画像" />
      </div>
      <div class="info">
        <strong>ページ ${clip.page_num}</strong>
        ${clip.note ? `<div class="note">${clip.note}</div>` : ''}
      </div>
      <div class="zoom-hint">クリックで拡大/縮小</div>
      <script>
        let zoomLevel = 1;
        function toggleZoom(container) {
          const img = container.querySelector('img');
          if (container.classList.contains('zoomed')) {
            container.classList.remove('zoomed');
            img.style.transform = 'scale(1)';
            zoomLevel = 1;
          } else {
            container.classList.add('zoomed');
            img.style.transform = 'scale(2)';
            zoomLevel = 2;
          }
        }
        document.addEventListener('wheel', function(e) {
          if (e.ctrlKey) {
            e.preventDefault();
            const container = document.querySelector('.image-container');
            const img = container.querySelector('img');
            if (e.deltaY < 0) {
              zoomLevel = Math.min(5, zoomLevel + 0.25);
            } else {
              zoomLevel = Math.max(0.5, zoomLevel - 0.25);
            }
            img.style.transform = 'scale(' + zoomLevel + ')';
            if (zoomLevel > 1) {
              container.classList.add('zoomed');
            } else {
              container.classList.remove('zoomed');
            }
          }
        }, { passive: false });
      </script>
    </body>
    </html>
  `)
  newWindow.document.close()
}

/**
 * EPUB内のコンテンツの画像パスを修正
 */
export function fixEpubImagePaths(content: string, bookId: string): string {
  return content
    .replace(/src="\/home\/[^"]*\/media\//g, `src="/api/books/${bookId}/media/`)
    .replace(/src="media\//g, `src="/api/books/${bookId}/media/`)
    .replace(/src="\.\/media\//g, `src="/api/books/${bookId}/media/`)
    .replace(/max-width:\s*800px/g, 'max-width: 100%')
}
