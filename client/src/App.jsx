import { Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import PdfViewer from './pages/PdfViewer'
import Reader from './pages/Reader'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/read/:bookId" element={<Reader />} />
      <Route path="/pdf/:bookId" element={<PdfViewer />} />
    </Routes>
  )
}

export default App
