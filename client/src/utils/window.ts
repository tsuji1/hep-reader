import type { Clip, ImageInfo } from '../types'

/**
 * 画像を新しいウィンドウで開く
 * EPUBの画像やPDFのクリップ画像を別ウィンドウで表示する共通関数
 */
export function openImageInNewWindow(image: ImageInfo): void {
  const newWindow = window.open('', '_blank', 'width=900,height=700,resizable=yes,scrollbars=no')
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
        html, body {
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: #1a1a2e;
        }
        body {
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .controls {
          position: fixed;
          top: 10px;
          right: 10px;
          display: flex;
          gap: 5px;
          z-index: 100;
          background: rgba(0,0,0,0.7);
          padding: 8px;
          border-radius: 8px;
        }
        .controls button {
          background: rgba(255,255,255,0.9);
          border: none;
          color: #333;
          width: 36px;
          height: 36px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 20px;
          font-weight: bold;
          transition: transform 0.1s;
        }
        .controls button:hover {
          background: #fff;
          transform: scale(1.1);
        }
        .controls span {
          color: white;
          line-height: 36px;
          padding: 0 10px;
          font-size: 14px;
          min-width: 60px;
          text-align: center;
        }
        .image-wrapper {
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
          cursor: grab;
        }
        .image-wrapper:active {
          cursor: grabbing;
        }
        .image-wrapper.dragging {
          cursor: grabbing;
        }
        img {
          position: absolute;
          left: 50%;
          top: 50%;
          border-radius: 4px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.4);
          transform-origin: center center;
          user-select: none;
          -webkit-user-drag: none;
        }
        .page-info {
          position: fixed;
          bottom: 40px;
          left: 50%;
          transform: translateX(-50%);
          color: #fff;
          padding: 10px;
          font-size: 14px;
          opacity: 0.8;
          text-align: center;
        }
        .hint {
          position: fixed;
          bottom: 10px;
          left: 50%;
          transform: translateX(-50%);
          color: rgba(255,255,255,0.6);
          font-size: 12px;
          pointer-events: none;
        }
      </style>
    </head>
    <body>
      <div class="controls">
        <button onclick="zoomOut()">−</button>
        <span id="zoom-level">100%</span>
        <button onclick="zoomIn()">+</button>
        <button onclick="resetZoom()">↺</button>
      </div>
      <div class="image-wrapper" id="wrapper">
        <img id="main-img" src="${image.src}" alt="${title}" draggable="false" />
      </div>
      ${pageInfo}
      <div class="hint">ドラッグで移動 / ホイール or Ctrl+ホイールで拡大縮小</div>
      <script>
        const img = document.getElementById('main-img');
        const wrapper = document.getElementById('wrapper');
        const zoomDisplay = document.getElementById('zoom-level');
        
        let scale = 1;
        let panX = 0;
        let panY = 0;
        let naturalW, naturalH;
        let fitScale = 1;
        
        // ドラッグ用
        let isDragging = false;
        let startX, startY, startPanX, startPanY;
        
        img.onload = function() {
          naturalW = img.naturalWidth;
          naturalH = img.naturalHeight;
          fitToWindow();
        };
        
        function fitToWindow() {
          const maxW = window.innerWidth - 40;
          const maxH = window.innerHeight - 60;
          const ratioW = maxW / naturalW;
          const ratioH = maxH / naturalH;
          fitScale = Math.min(ratioW, ratioH, 1);
          scale = fitScale;
          panX = 0;
          panY = 0;
          applyTransform();
        }
        
        function applyTransform() {
          const w = naturalW * scale;
          const h = naturalH * scale;
          img.style.width = w + 'px';
          img.style.height = h + 'px';
          img.style.transform = 'translate(calc(-50% + ' + panX + 'px), calc(-50% + ' + panY + 'px))';
          zoomDisplay.textContent = Math.round(scale * 100) + '%';
        }
        
        function zoomIn() {
          scale = Math.min(10, scale * 1.25);
          applyTransform();
        }
        
        function zoomOut() {
          scale = Math.max(0.1, scale / 1.25);
          applyTransform();
        }
        
        function resetZoom() {
          fitToWindow();
        }
        
        window.addEventListener('resize', fitToWindow);
        
        // ホイールで拡大縮小（Ctrlなしでも可能に）
        wrapper.addEventListener('wheel', function(e) {
          e.preventDefault();
          if (e.deltaY < 0) zoomIn();
          else zoomOut();
        }, { passive: false });
        
        // ドラッグ処理
        wrapper.addEventListener('mousedown', function(e) {
          if (e.button !== 0) return;
          isDragging = true;
          startX = e.clientX;
          startY = e.clientY;
          startPanX = panX;
          startPanY = panY;
          wrapper.classList.add('dragging');
          e.preventDefault();
        });
        
        document.addEventListener('mousemove', function(e) {
          if (!isDragging) return;
          panX = startPanX + (e.clientX - startX);
          panY = startPanY + (e.clientY - startY);
          applyTransform();
        });
        
        document.addEventListener('mouseup', function() {
          isDragging = false;
          wrapper.classList.remove('dragging');
        });
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
  const newWindow = window.open('', '_blank', 'width=700,height=600,resizable=yes,scrollbars=no')
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
        html, body {
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: #1a1a2e;
        }
        body {
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .controls {
          position: fixed;
          top: 10px;
          right: 10px;
          display: flex;
          gap: 5px;
          z-index: 100;
          background: rgba(0,0,0,0.7);
          padding: 8px;
          border-radius: 8px;
        }
        .controls button {
          background: rgba(255,255,255,0.9);
          border: none;
          color: #333;
          width: 36px;
          height: 36px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 20px;
          font-weight: bold;
          transition: transform 0.1s;
        }
        .controls button:hover {
          background: #fff;
          transform: scale(1.1);
        }
        .controls span {
          color: white;
          line-height: 36px;
          padding: 0 10px;
          font-size: 14px;
          min-width: 60px;
          text-align: center;
        }
        .image-wrapper {
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
          cursor: grab;
        }
        .image-wrapper:active, .image-wrapper.dragging {
          cursor: grabbing;
        }
        img {
          position: absolute;
          left: 50%;
          top: 50%;
          border-radius: 4px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.4);
          user-select: none;
          -webkit-user-drag: none;
        }
        .info {
          position: fixed;
          bottom: 40px;
          left: 50%;
          transform: translateX(-50%);
          color: #fff;
          text-align: center;
        }
        .note {
          color: #aaa;
          font-size: 14px;
          margin-top: 5px;
        }
        .hint {
          position: fixed;
          bottom: 10px;
          left: 50%;
          transform: translateX(-50%);
          color: rgba(255,255,255,0.6);
          font-size: 12px;
          pointer-events: none;
        }
      </style>
    </head>
    <body>
      <div class="controls">
        <button onclick="zoomOut()">−</button>
        <span id="zoom-level">100%</span>
        <button onclick="zoomIn()">+</button>
        <button onclick="resetZoom()">↺</button>
      </div>
      <div class="image-wrapper" id="wrapper">
        <img id="main-img" src="${clip.image_data}" alt="クリップ画像" draggable="false" />
      </div>
      <div class="info">
        <strong>ページ ${clip.page_num}</strong>
        ${clip.note ? `<div class="note">${clip.note}</div>` : ''}
      </div>
      <div class="hint">ドラッグで移動 / ホイールで拡大縮小</div>
      <script>
        const img = document.getElementById('main-img');
        const wrapper = document.getElementById('wrapper');
        const zoomDisplay = document.getElementById('zoom-level');
        
        let scale = 1;
        let panX = 0;
        let panY = 0;
        let naturalW, naturalH;
        let fitScale = 1;
        
        let isDragging = false;
        let startX, startY, startPanX, startPanY;
        
        img.onload = function() {
          naturalW = img.naturalWidth;
          naturalH = img.naturalHeight;
          fitToWindow();
        };
        
        function fitToWindow() {
          const maxW = window.innerWidth - 40;
          const maxH = window.innerHeight - 80;
          const ratioW = maxW / naturalW;
          const ratioH = maxH / naturalH;
          fitScale = Math.min(ratioW, ratioH, 1);
          scale = fitScale;
          panX = 0;
          panY = 0;
          applyTransform();
        }
        
        function applyTransform() {
          img.style.width = (naturalW * scale) + 'px';
          img.style.height = (naturalH * scale) + 'px';
          img.style.transform = 'translate(calc(-50% + ' + panX + 'px), calc(-50% + ' + panY + 'px))';
          zoomDisplay.textContent = Math.round(scale * 100) + '%';
        }
        
        function zoomIn() {
          scale = Math.min(10, scale * 1.25);
          applyTransform();
        }
        
        function zoomOut() {
          scale = Math.max(0.1, scale / 1.25);
          applyTransform();
        }
        
        function resetZoom() {
          fitToWindow();
        }
        
        window.addEventListener('resize', fitToWindow);
        
        wrapper.addEventListener('wheel', function(e) {
          e.preventDefault();
          if (e.deltaY < 0) zoomIn();
          else zoomOut();
        }, { passive: false });
        
        wrapper.addEventListener('mousedown', function(e) {
          if (e.button !== 0) return;
          isDragging = true;
          startX = e.clientX;
          startY = e.clientY;
          startPanX = panX;
          startPanY = panY;
          wrapper.classList.add('dragging');
          e.preventDefault();
        });
        
        document.addEventListener('mousemove', function(e) {
          if (!isDragging) return;
          panX = startPanX + (e.clientX - startX);
          panY = startPanY + (e.clientY - startY);
          applyTransform();
        });
        
        document.addEventListener('mouseup', function() {
          isDragging = false;
          wrapper.classList.remove('dragging');
        });
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
