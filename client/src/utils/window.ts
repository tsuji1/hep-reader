import type { Clip, ImageInfo } from '../types'

/**
 * 画像を新しいウィンドウで開く
 * EPUBの画像やPDFのクリップ画像を別ウィンドウで表示する共通関数
 */
export function openImageInNewWindow(image: ImageInfo): void {
  const newWindow = window.open('', '_blank', 'width=900,height=700,resizable=yes,scrollbars=yes')
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
          overflow: auto;
          background: #1a1a2e;
        }
        body {
          display: flex;
          flex-direction: column;
          padding: 10px;
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
        .image-container {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 50px 20px 20px;
          min-width: fit-content;
        }
        .image-container.zoomed {
          align-items: flex-start;
          justify-content: flex-start;
        }
        img {
          display: block;
          border-radius: 4px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.4);
          cursor: grab;
        }
        img:active {
          cursor: grabbing;
        }
        .page-info {
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
        body.dragging {
          cursor: grabbing !important;
          user-select: none;
        }
        body.dragging img {
          cursor: grabbing !important;
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
      <div class="image-container" id="container">
        <img id="main-img" src="${image.src}" alt="${title}" draggable="false" ondragstart="return false" />
      </div>
      ${pageInfo}
      <div class="hint">ドラッグで移動 / Ctrl+ホイールで拡大縮小</div>
      <script>
        const img = document.getElementById('main-img');
        const container = document.getElementById('container');
        const zoomDisplay = document.getElementById('zoom-level');
        let scale = 1;
        let naturalW, naturalH;
        let fitScale = 1;
        
        // ドラッグ用変数
        let isDragging = false;
        let startX, startY, scrollLeft, scrollTop;
        
        img.onload = function() {
          naturalW = img.naturalWidth;
          naturalH = img.naturalHeight;
          fitToWindow();
        };
        
        function fitToWindow() {
          const maxW = window.innerWidth - 60;
          const maxH = window.innerHeight - 100;
          const ratioW = maxW / naturalW;
          const ratioH = maxH / naturalH;
          fitScale = Math.min(ratioW, ratioH, 1);
          scale = fitScale;
          applyScale();
        }
        
        function applyScale() {
          img.style.width = (naturalW * scale) + 'px';
          img.style.height = (naturalH * scale) + 'px';
          zoomDisplay.textContent = Math.round(scale * 100) + '%';
          
          // 拡大時はflex-startにしてスクロール可能に
          if (scale > fitScale * 1.1) {
            container.classList.add('zoomed');
          } else {
            container.classList.remove('zoomed');
          }
        }
        
        function zoomIn() {
          scale = Math.min(5, scale + 0.25);
          applyScale();
        }
        
        function zoomOut() {
          scale = Math.max(0.1, scale - 0.25);
          applyScale();
        }
        
        function resetZoom() {
          fitToWindow();
          window.scrollTo(0, 0);
        }
        
        window.addEventListener('resize', () => {
          const oldFitScale = fitScale;
          const maxW = window.innerWidth - 60;
          const maxH = window.innerHeight - 100;
          fitScale = Math.min(maxW / naturalW, maxH / naturalH, 1);
          if (Math.abs(scale - oldFitScale) < 0.01) {
            scale = fitScale;
            applyScale();
          }
        });
        
        document.addEventListener('wheel', function(e) {
          if (e.ctrlKey) {
            e.preventDefault();
            if (e.deltaY < 0) zoomIn();
            else zoomOut();
          }
        }, { passive: false });
        
        // ドラッグ処理
        document.addEventListener('mousedown', function(e) {
          if (e.button !== 0) return; // 左クリックのみ
          if (e.target.closest('.controls')) return; // コントロール上は無視
          
          isDragging = true;
          startX = e.clientX;
          startY = e.clientY;
          scrollLeft = window.scrollX;
          scrollTop = window.scrollY;
          document.body.classList.add('dragging');
          e.preventDefault();
        });
        
        document.addEventListener('mousemove', function(e) {
          if (!isDragging) return;
          
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          window.scrollTo(scrollLeft - dx, scrollTop - dy);
        });
        
        document.addEventListener('mouseup', function() {
          isDragging = false;
          document.body.classList.remove('dragging');
        });
        
        document.addEventListener('mouseleave', function() {
          isDragging = false;
          document.body.classList.remove('dragging');
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
  const newWindow = window.open('', '_blank', 'width=700,height=600,resizable=yes,scrollbars=yes')
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
          overflow: auto;
          background: #1a1a2e;
        }
        body {
          display: flex;
          flex-direction: column;
          padding: 10px;
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
        .image-container {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 50px 20px 20px;
          min-width: fit-content;
        }
        .image-container.zoomed {
          align-items: flex-start;
          justify-content: flex-start;
        }
        img {
          display: block;
          border-radius: 4px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          cursor: grab;
        }
        img:active {
          cursor: grabbing;
        }
        .info {
          color: #fff;
          padding: 10px;
          text-align: center;
        }
        .note {
          color: #aaa;
          font-size: 14px;
          margin-top: 8px;
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
        body.dragging {
          cursor: grabbing !important;
          user-select: none;
        }
        body.dragging img {
          cursor: grabbing !important;
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
      <div class="image-container" id="container">
        <img id="main-img" src="${clip.image_data}" alt="クリップ画像" draggable="false" ondragstart="return false" />
      </div>
      <div class="info">
        <strong>ページ ${clip.page_num}</strong>
        ${clip.note ? `<div class="note">${clip.note}</div>` : ''}
      </div>
      <div class="hint">ドラッグで移動 / Ctrl+ホイールで拡大縮小</div>
      <script>
        const img = document.getElementById('main-img');
        const container = document.getElementById('container');
        const zoomDisplay = document.getElementById('zoom-level');
        let scale = 1;
        let naturalW, naturalH;
        let fitScale = 1;
        
        // ドラッグ用変数
        let isDragging = false;
        let startX, startY, scrollLeft, scrollTop;
        
        img.onload = function() {
          naturalW = img.naturalWidth;
          naturalH = img.naturalHeight;
          fitToWindow();
        };
        
        function fitToWindow() {
          const maxW = window.innerWidth - 60;
          const maxH = window.innerHeight - 120;
          const ratioW = maxW / naturalW;
          const ratioH = maxH / naturalH;
          fitScale = Math.min(ratioW, ratioH, 1);
          scale = fitScale;
          applyScale();
        }
        
        function applyScale() {
          img.style.width = (naturalW * scale) + 'px';
          img.style.height = (naturalH * scale) + 'px';
          zoomDisplay.textContent = Math.round(scale * 100) + '%';
          
          if (scale > fitScale * 1.1) {
            container.classList.add('zoomed');
          } else {
            container.classList.remove('zoomed');
          }
        }
        
        function zoomIn() {
          scale = Math.min(5, scale + 0.25);
          applyScale();
        }
        
        function zoomOut() {
          scale = Math.max(0.1, scale - 0.25);
          applyScale();
        }
        
        function resetZoom() {
          fitToWindow();
          window.scrollTo(0, 0);
        }
        
        window.addEventListener('resize', () => {
          const oldFitScale = fitScale;
          const maxW = window.innerWidth - 60;
          const maxH = window.innerHeight - 120;
          fitScale = Math.min(maxW / naturalW, maxH / naturalH, 1);
          if (Math.abs(scale - oldFitScale) < 0.01) {
            scale = fitScale;
            applyScale();
          }
        });
        
        document.addEventListener('wheel', function(e) {
          if (e.ctrlKey) {
            e.preventDefault();
            if (e.deltaY < 0) zoomIn();
            else zoomOut();
          }
        }, { passive: false });
        
        // ドラッグ処理
        document.addEventListener('mousedown', function(e) {
          if (e.button !== 0) return;
          if (e.target.closest('.controls')) return;
          
          isDragging = true;
          startX = e.clientX;
          startY = e.clientY;
          scrollLeft = window.scrollX;
          scrollTop = window.scrollY;
          document.body.classList.add('dragging');
          e.preventDefault();
        });
        
        document.addEventListener('mousemove', function(e) {
          if (!isDragging) return;
          
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          window.scrollTo(scrollLeft - dx, scrollTop - dy);
        });
        
        document.addEventListener('mouseup', function() {
          isDragging = false;
          document.body.classList.remove('dragging');
        });
        
        document.addEventListener('mouseleave', function() {
          isDragging = false;
          document.body.classList.remove('dragging');
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
