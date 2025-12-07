import type { Book, BookInput, Bookmark, Clip, ClipPosition, ReadingProgress } from './types';
export declare function addBook(id: string, title: string, originalFilename: string, totalPages: number, bookType?: 'epub' | 'pdf'): {
    id: string;
    title: string;
    originalFilename: string;
    totalPages: number;
    bookType: string;
};
export declare function addWebsiteBook(id: string, title: string, sourceUrl: string, totalPages: number): {
    id: string;
    title: string;
    sourceUrl: string;
    totalPages: number;
    bookType: string;
};
export declare function getAllBooks(): Book[];
export declare function getBook(id: string): Book | undefined;
export declare function deleteBook(id: string): void;
export declare function updateBook(id: string, { title, language, ai_context }: BookInput): Book | null;
export declare function addBookmark(bookId: string, pageNum: number, note?: string): {
    id: string;
    bookId: string;
    pageNum: number;
    note: string;
};
export declare function getBookmarks(bookId: string): Bookmark[];
export declare function deleteBookmark(id: string): void;
export declare function saveProgress(bookId: string, currentPage: number): void;
export declare function getProgress(bookId: string): ReadingProgress | undefined;
export declare function addClip(bookId: string, pageNum: number, imageData: string, note?: string, position?: ClipPosition | null): Clip;
export declare function getClips(bookId: string): Clip[];
export declare function getClip(id: string): Clip | undefined;
export declare function deleteClip(id: string): void;
export declare function updatePdfTotalPages(bookId: string, pdfTotalPages: number): void;
export interface TagRecord {
    id: string;
    name: string;
    color: string;
}
export declare function getAllTags(): TagRecord[];
export declare function createTag(name: string, color?: string): TagRecord;
export declare function deleteTag(id: string): void;
export declare function getBookTags(bookId: string): TagRecord[];
export declare function addTagToBook(bookId: string, tagId: string): void;
export declare function removeTagFromBook(bookId: string, tagId: string): void;
export interface AiSetting {
    provider: string;
    api_key: string;
    model: string | null;
}
export declare function getAiSettings(): AiSetting[];
export declare function getAiSetting(provider: string): AiSetting | undefined;
export declare function saveAiSetting(provider: string, apiKey: string, model?: string | null): {
    provider: string;
    model: string | null;
};
export declare function deleteAiSetting(provider: string): void;
declare const _default: {
    addBook: typeof addBook;
    addWebsiteBook: typeof addWebsiteBook;
    getAllBooks: typeof getAllBooks;
    getBook: typeof getBook;
    deleteBook: typeof deleteBook;
    updateBook: typeof updateBook;
    updatePdfTotalPages: typeof updatePdfTotalPages;
    addBookmark: typeof addBookmark;
    getBookmarks: typeof getBookmarks;
    deleteBookmark: typeof deleteBookmark;
    saveProgress: typeof saveProgress;
    getProgress: typeof getProgress;
    addClip: typeof addClip;
    getClips: typeof getClips;
    getClip: typeof getClip;
    deleteClip: typeof deleteClip;
    getAllTags: typeof getAllTags;
    createTag: typeof createTag;
    deleteTag: typeof deleteTag;
    getBookTags: typeof getBookTags;
    addTagToBook: typeof addTagToBook;
    removeTagFromBook: typeof removeTagFromBook;
    getAiSettings: typeof getAiSettings;
    getAiSetting: typeof getAiSetting;
    saveAiSetting: typeof saveAiSetting;
    deleteAiSetting: typeof deleteAiSetting;
};
export default _default;
//# sourceMappingURL=database.d.ts.map