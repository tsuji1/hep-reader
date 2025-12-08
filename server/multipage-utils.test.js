/**
 * Multi-page URL Crawling Utility Tests
 * t-wada TDD style: テスト可能な純粋関数のユニットテスト
 */
import { describe, expect, it } from 'vitest'
import {
  isValidHttpUrl,
  normalizeClassSelector,
  normalizeUrl,
  resolveUrl,
  shouldIgnorePath
} from './multipage-utils'

describe('shouldIgnorePath', () => {
  describe('exact path matching', () => {
    it('should match exact path', () => {
      expect(shouldIgnorePath('/api.html', ['/api.html'])).toBe(true)
    })

    it('should not match different path', () => {
      expect(shouldIgnorePath('/api.html', ['/about'])).toBe(false)
    })
  })

  describe('partial path matching (contains)', () => {
    it('should match path containing ignore pattern', () => {
      expect(shouldIgnorePath('/docs/api/v1/index.html', ['/api/'])).toBe(true)
    })

    it('should not match path not containing ignore pattern', () => {
      expect(shouldIgnorePath('/docs/index.html', ['/api/'])).toBe(false)
    })
  })

  describe('wildcard prefix (*pattern) - 末尾マッチ', () => {
    it('should match path ending with pattern', () => {
      expect(shouldIgnorePath('/docs/file.pdf', ['*.pdf'])).toBe(true)
    })

    it('should not match path not ending with pattern', () => {
      expect(shouldIgnorePath('/docs/file.html', ['*.pdf'])).toBe(false)
    })

    it('should match multiple file extensions', () => {
      expect(shouldIgnorePath('/docs/file.doc', ['*.doc'])).toBe(true)
      expect(shouldIgnorePath('/docs/file.docx', ['*.docx'])).toBe(true)
    })
  })

  describe('wildcard suffix (pattern*) - 先頭マッチ', () => {
    it('should match path starting with pattern', () => {
      expect(shouldIgnorePath('/admin/settings', ['/admin*'])).toBe(true)
    })

    it('should not match path not starting with pattern', () => {
      expect(shouldIgnorePath('/user/settings', ['/admin*'])).toBe(false)
    })

    it('should match exact path with wildcard suffix', () => {
      expect(shouldIgnorePath('/admin', ['/admin*'])).toBe(true)
    })
  })

  describe('multiple ignore paths', () => {
    const ignorePaths = ['/api.html', '/about', '*.pdf']

    it('should match first ignore path', () => {
      expect(shouldIgnorePath('/api.html', ignorePaths)).toBe(true)
    })

    it('should match second ignore path', () => {
      expect(shouldIgnorePath('/about', ignorePaths)).toBe(true)
    })

    it('should match third ignore path (wildcard)', () => {
      expect(shouldIgnorePath('/doc.pdf', ignorePaths)).toBe(true)
    })

    it('should not match any ignore path', () => {
      expect(shouldIgnorePath('/index.html', ignorePaths)).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('should handle empty ignore paths array', () => {
      expect(shouldIgnorePath('/any/path', [])).toBe(false)
    })

    it('should handle empty path', () => {
      expect(shouldIgnorePath('', ['/api'])).toBe(false)
    })

    it('should handle root path', () => {
      expect(shouldIgnorePath('/', ['/'])).toBe(true)
    })
  })
})

describe('normalizeClassSelector', () => {
  it('should add dot prefix to plain class name', () => {
    expect(normalizeClassSelector('next-page')).toBe('.next-page')
  })

  it('should keep dot prefix if already present', () => {
    expect(normalizeClassSelector('.next-page')).toBe('.next-page')
  })

  it('should keep a. prefix if already present', () => {
    expect(normalizeClassSelector('a.next-page')).toBe('a.next-page')
  })

  it('should handle class name with multiple dashes', () => {
    expect(normalizeClassSelector('pagination-next-link')).toBe('.pagination-next-link')
  })

  it('should handle single character class name', () => {
    expect(normalizeClassSelector('a')).toBe('.a')
  })
})

describe('normalizeUrl', () => {
  it('should normalize URL without trailing slash', () => {
    expect(normalizeUrl('https://example.com/page')).toBe('https://example.com/page')
  })

  it('should keep trailing slash if present', () => {
    expect(normalizeUrl('https://example.com/page/')).toBe('https://example.com/page/')
  })

  it('should add trailing slash to root', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/')
  })

  it('should handle URL with query string', () => {
    expect(normalizeUrl('https://example.com/page?a=1')).toBe('https://example.com/page?a=1')
  })

  it('should handle URL with hash', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page#section')
  })

  it('should return original string for invalid URL', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url')
  })
})

describe('resolveUrl', () => {
  const baseUrl = 'https://example.com/docs/page1.html'

  it('should resolve relative URL (same directory)', () => {
    expect(resolveUrl('page2.html', baseUrl)).toBe('https://example.com/docs/page2.html')
  })

  it('should resolve relative URL (parent directory)', () => {
    expect(resolveUrl('../other/page.html', baseUrl)).toBe('https://example.com/other/page.html')
  })

  it('should resolve absolute path URL', () => {
    expect(resolveUrl('/root/page.html', baseUrl)).toBe('https://example.com/root/page.html')
  })

  it('should return absolute URL as-is', () => {
    expect(resolveUrl('https://other.com/page.html', baseUrl)).toBe('https://other.com/page.html')
  })

  it('should handle protocol-relative URL as relative path', () => {
    // "://invalid" is treated as a relative path by URL API, not as invalid
    expect(resolveUrl('://invalid', baseUrl)).toBe('https://example.com/docs/://invalid')
  })

  it('should handle empty href', () => {
    // Empty string resolves to base URL
    expect(resolveUrl('', baseUrl)).toBe(baseUrl)
  })
})

describe('isValidHttpUrl', () => {
  describe('valid URLs', () => {
    it('should accept http URL', () => {
      expect(isValidHttpUrl('http://example.com')).toBe(true)
    })

    it('should accept https URL', () => {
      expect(isValidHttpUrl('https://example.com')).toBe(true)
    })

    it('should accept URL with path', () => {
      expect(isValidHttpUrl('https://example.com/path/to/page')).toBe(true)
    })

    it('should accept URL with query string', () => {
      expect(isValidHttpUrl('https://example.com/page?query=1')).toBe(true)
    })

    it('should accept URL with port', () => {
      expect(isValidHttpUrl('https://example.com:8080/page')).toBe(true)
    })
  })

  describe('invalid URLs', () => {
    it('should reject ftp URL', () => {
      expect(isValidHttpUrl('ftp://example.com')).toBe(false)
    })

    it('should reject file URL', () => {
      expect(isValidHttpUrl('file:///path/to/file')).toBe(false)
    })

    it('should reject javascript URL', () => {
      expect(isValidHttpUrl('javascript:alert(1)')).toBe(false)
    })

    it('should reject malformed URL', () => {
      expect(isValidHttpUrl('not-a-valid-url')).toBe(false)
    })

    it('should reject empty string', () => {
      expect(isValidHttpUrl('')).toBe(false)
    })
  })
})
