import { Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Reader from './pages/Reader'
import PdfViewer from './pages/PdfViewer'

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
