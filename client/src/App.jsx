import { Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Reader from './pages/Reader'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/read/:bookId" element={<Reader />} />
      {/* PDFも同じReaderを使用 */}
      <Route path="/pdf/:bookId" element={<Reader />} />
    </Routes>
  )
}

export default App
