// Book Types
export interface Book {
  id: string
  title: string
  original_filename: string
  total_pages: number
  pdf_total_pages?: number
  category?: string
  language: string
  book_type?: 'epub' | 'pdf' | 'website' | 'markdown'
  source_url?: string
  ai_context?: string
  current_page?: number
  created_at: string
  updated_at: string
  tags?: Tag[]
}

// Tag Types
export interface Tag {
  id: string
  name: string
  color: string
}

// Bookmark Types
export interface Bookmark {
  id: string
  book_id: string
  page_num: number
  note: string
  created_at: string
}

// Clip Types
export interface Clip {
  id: string
  book_id: string
  page_num: number
  image_data: string
  note: string
  x_ratio?: number
  y_ratio?: number
  width_ratio?: number
  height_ratio?: number
  created_at: string
}

export interface ClipPosition {
  xRatio: number
  yRatio: number
  widthRatio: number
  heightRatio: number
}

// TOC Types
export interface TocItem {
  title: string
  page: number
  level: number
}

// Page Types
export interface PageContent {
  pageNum: number
  content: string
}

// Image Popup Types
export interface ImageInfo {
  src: string
  alt?: string
  pageNum?: number
}

// Note Types (差し込みエディタ用)
export interface Note {
  id: string
  book_id: string
  page_num: number
  content: string
  position: number
  created_at: string
  updated_at: string
}

// Vocabulary Types (用語集)
export interface Vocabulary {
  id: string
  term: string
  description: string
  is_local?: boolean
  created_at?: string
  updated_at?: string
}
