import type { Book, BookInput, Bookmark, ReadingProgress, Clip, ClipPosition } from './types';
export declare function addBook(id: string, title: string, originalFilename: string, totalPages: number, bookType?: 'epub' | 'pdf'): {
    id: string;
    title: string;
    originalFilename: string;
    totalPages: number;
    bookType: string;
};
export declare function getAllBooks(): Book[];
export declare function getBook(id: string): Book | undefined;
export declare function deleteBook(id: string): void;
export declare function updateBook(id: string, { title, language }: BookInput): Book | null;
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
declare const _default: {
    addBook: typeof addBook;
    getAllBooks: typeof getAllBooks;
    getBook: typeof getBook;
    deleteBook: typeof deleteBook;
    updateBook: typeof updateBook;
    addBookmark: typeof addBookmark;
    getBookmarks: typeof getBookmarks;
    deleteBookmark: typeof deleteBookmark;
    saveProgress: typeof saveProgress;
    getProgress: typeof getProgress;
    addClip: typeof addClip;
    getClips: typeof getClips;
    getClip: typeof getClip;
    deleteClip: typeof deleteClip;
};
export default _default;
//# sourceMappingURL=database.d.ts.map