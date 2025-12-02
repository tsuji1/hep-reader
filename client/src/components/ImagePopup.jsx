import { useEffect } from 'react'

function ImagePopup({ src, alt, onClose }) {
  // ESCキーで閉じる
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="image-popup-overlay" onClick={onClose}>
      <button className="image-popup-close" onClick={onClose}>✕</button>
      <div className="image-popup-content" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={alt || '画像'} />
      </div>
    </div>
  )
}

export default ImagePopup
