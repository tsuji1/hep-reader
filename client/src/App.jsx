import { Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Reader from './pages/Reader'
import Settings from './pages/Settings'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/read/:bookId" element={<Reader />} />
      {/* PDFも同じReaderを使用 */}
      <Route path="/pdf/:bookId" element={<Reader />} />
      <Route path="/settings" element={<Settings />} />
    </Routes>
  )
}

export default App
