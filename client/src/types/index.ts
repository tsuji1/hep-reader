// Book Types
export interface Book {
  id: string
  title: string
  original_filename: string
  total_pages: number
  category?: string
  language: string
  book_type?: 'epub' | 'pdf'
  current_page?: number
  created_at: string
  updated_at: string
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
