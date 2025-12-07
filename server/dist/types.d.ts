export interface Book {
    id: string;
    title: string;
    original_filename: string | null;
    total_pages: number;
    pdf_total_pages: number | null;
    category: string | null;
    language: string;
    book_type: 'epub' | 'pdf' | 'website';
    source_url: string | null;
    ai_context: string | null;
    created_at: string;
    updated_at: string;
    current_page?: number;
    tags?: Tag[];
}
export interface Tag {
    id: string;
    name: string;
    color: string;
}
export interface BookInput {
    title?: string;
    language?: string;
    ai_context?: string;
}
export interface WebsiteMetadata {
    title: string;
    description: string | null;
    ogImage: string | null;
    favicon: string | null;
    siteName: string | null;
}
export interface Bookmark {
    id: string;
    book_id: string;
    page_num: number;
    note: string | null;
    created_at: string;
}
export interface ReadingProgress {
    book_id: string;
    current_page: number;
    updated_at: string;
}
export interface ClipPosition {
    xRatio: number;
    yRatio: number;
    widthRatio: number;
    heightRatio: number;
}
export interface Clip {
    id: string;
    book_id: string;
    page_num: number;
    image_data: string;
    note: string | null;
    x_ratio: number | null;
    y_ratio: number | null;
    width_ratio: number | null;
    height_ratio: number | null;
    created_at: string;
}
export interface UploadResponse {
    success: boolean;
    bookId: string;
    title: string;
    bookType: 'epub' | 'pdf' | 'website';
    totalPages: number;
}
export interface PagesInfo {
    total: number;
    pages: string[];
}
export interface PageContent {
    content: string;
    pageNum: number;
}
export interface TocItem {
    page: number;
    level: number;
    title: string;
}
export interface BookTag {
    book_id: string;
    tag_id: string;
}
export interface AllPagesResponse {
    pages: PageContent[];
    total: number;
}
//# sourceMappingURL=types.d.ts.map