export interface Book {
    id: string;
    title: string;
    original_filename: string | null;
    total_pages: number;
    category: string | null;
    language: string;
    book_type: 'epub' | 'pdf';
    created_at: string;
    updated_at: string;
    current_page?: number;
}
export interface BookInput {
    title?: string;
    language?: string;
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
    bookType: 'epub' | 'pdf';
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
export interface AllPagesResponse {
    pages: PageContent[];
    total: number;
}
//# sourceMappingURL=types.d.ts.map