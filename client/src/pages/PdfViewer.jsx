import axios from 'axios'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

function PdfViewer() {
  const { bookId } = useParams()
  const [book, setBook] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchBook = async () => {
      try {
        const res = await axios.get(`/api/books/${bookId}`)
        setBook(res.data)
      } catch (error) {
        console.error('Failed to fetch book:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchBook()
  }, [bookId])

  if (loading) {
    return <div className="loading">読み込み中</div>
  }

  if (!book) {
    return (
      <div className="error">
        <p>書籍が見つかりません</p>
        <Link to="/">ライブラリに戻る</Link>
      </div>
    )
  }

  return (
    <div className="pdf-viewer">
      <header className="pdf-header">
        <Link to="/" className="back-link">← ライブラリ</Link>
        <h1>{book.title}</h1>
      </header>
      <div className="pdf-container">
        <iframe
          src={`/api/books/${bookId}/pdf`}
          title={book.title}
          className="pdf-iframe"
        />
      </div>
    </div>
  )
}

export default PdfViewer
