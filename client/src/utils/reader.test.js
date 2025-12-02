/**
 * Reader Utility Tests
 * t-wada TDD style
 */
import { describe, it, expect } from 'vitest'
import {
  fixImagePaths,
  fixMaxWidth,
  fixContent,
  sortBooks,
  getLanguageDisplayName
} from './reader'

describe('fixImagePaths', () => {
  const bookId = 'abc-123'

  it('should convert absolute /home/ paths to API paths', () => {
    const content = '<img src="/home/user/app/converted/abc/media/image.png">'
    
    const result = fixImagePaths(content, bookId)
    
    expect(result).toBe(`<img src="/api/books/${bookId}/media/image.png">`)
  })

  it('should convert relative media/ paths to API paths', () => {
    const content = '<img src="media/cover.jpg">'
    
    const result = fixImagePaths(content, bookId)
    
    expect(result).toBe(`<img src="/api/books/${bookId}/media/cover.jpg">`)
  })

  it('should convert ./media/ paths to API paths', () => {
    const content = '<img src="./media/figure1.png">'
    
    const result = fixImagePaths(content, bookId)
    
    expect(result).toBe(`<img src="/api/books/${bookId}/media/figure1.png">`)
  })

  it('should handle multiple images in content', () => {
    const content = `
      <img src="media/img1.png">
      <p>Some text</p>
      <img src="media/img2.jpg">
    `
    
    const result = fixImagePaths(content, bookId)
    
    expect(result).toContain(`src="/api/books/${bookId}/media/img1.png"`)
    expect(result).toContain(`src="/api/books/${bookId}/media/img2.jpg"`)
  })

  it('should not modify already correct API paths', () => {
    const content = `<img src="/api/books/${bookId}/media/image.png">`
    
    const result = fixImagePaths(content, bookId)
    
    expect(result).toBe(content)
  })

  it('should handle content with no images', () => {
    const content = '<p>Just text, no images</p>'
    
    const result = fixImagePaths(content, bookId)
    
    expect(result).toBe(content)
  })
})

describe('fixMaxWidth', () => {
  it('should replace max-width: 800px with 100%', () => {
    const content = 'body { max-width: 800px; }'
    
    const result = fixMaxWidth(content)
    
    expect(result).toBe('body { max-width: 100%; }')
  })

  it('should handle max-width with spaces', () => {
    const content = 'max-width:800px'
    
    const result = fixMaxWidth(content)
    
    expect(result).toBe('max-width: 100%')
  })

  it('should not modify other max-width values', () => {
    const content = 'max-width: 600px'
    
    const result = fixMaxWidth(content)
    
    expect(result).toBe('max-width: 600px')
  })
})

describe('fixContent', () => {
  it('should apply both image path and max-width fixes', () => {
    const content = `
      <style>body { max-width: 800px; }</style>
      <img src="media/test.png">
    `
    const bookId = 'test-book'
    
    const result = fixContent(content, bookId)
    
    expect(result).toContain('max-width: 100%')
    expect(result).toContain(`src="/api/books/${bookId}/media/test.png"`)
  })
})

describe('sortBooks', () => {
  const books = [
    { title: 'Alpha', created_at: '2024-01-01', updated_at: '2024-03-01' },
    { title: 'Charlie', created_at: '2024-02-01', updated_at: '2024-01-01' },
    { title: 'Bravo', created_at: '2024-03-01', updated_at: '2024-02-01' }
  ]

  it('should sort by title alphabetically', () => {
    const result = sortBooks(books, 'title')
    
    expect(result[0].title).toBe('Alpha')
    expect(result[1].title).toBe('Bravo')
    expect(result[2].title).toBe('Charlie')
  })

  it('should sort by added date (newest first)', () => {
    const result = sortBooks(books, 'added')
    
    expect(result[0].title).toBe('Bravo')  // 2024-03-01
    expect(result[1].title).toBe('Charlie') // 2024-02-01
    expect(result[2].title).toBe('Alpha')   // 2024-01-01
  })

  it('should sort by last read (most recent first)', () => {
    const result = sortBooks(books, 'lastRead')
    
    expect(result[0].title).toBe('Alpha')   // 2024-03-01
    expect(result[1].title).toBe('Bravo')   // 2024-02-01
    expect(result[2].title).toBe('Charlie') // 2024-01-01
  })

  it('should default to lastRead for unknown sortBy', () => {
    const result = sortBooks(books, 'unknown')
    
    expect(result[0].title).toBe('Alpha')
  })

  it('should not mutate original array', () => {
    const original = [...books]
    
    sortBooks(books, 'title')
    
    expect(books).toEqual(original)
  })

  it('should handle empty array', () => {
    const result = sortBooks([], 'title')
    
    expect(result).toEqual([])
  })
})

describe('getLanguageDisplayName', () => {
  it('should return Japanese for ja', () => {
    expect(getLanguageDisplayName('ja')).toBe('日本語')
  })

  it('should return English for en', () => {
    expect(getLanguageDisplayName('en')).toBe('英語')
  })

  it('should return the code itself for unknown languages', () => {
    expect(getLanguageDisplayName('pt')).toBe('pt')
  })

  it('should return English for undefined/null', () => {
    expect(getLanguageDisplayName(undefined)).toBe('英語')
    expect(getLanguageDisplayName(null)).toBe('英語')
  })
})
