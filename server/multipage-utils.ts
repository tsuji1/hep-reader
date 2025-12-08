/**
 * Multi-page URL crawling utility functions
 * テスト可能な純粋関数として抽出
 */

/**
 * URLパスが無視リストにマッチするかチェック
 * @param urlPath - チェックするURLパス
 * @param ignorePaths - 無視するパスのリスト
 * @returns マッチする場合true
 */
export function shouldIgnorePath(urlPath: string, ignorePaths: string[]): boolean {
  return ignorePaths.some(ignorePath => {
    // ワイルドカードプレフィックス (*pattern) - 末尾マッチ
    if (ignorePath.startsWith('*')) {
      return urlPath.endsWith(ignorePath.slice(1));
    }
    // ワイルドカードサフィックス (pattern*) - 先頭マッチ
    if (ignorePath.endsWith('*')) {
      return urlPath.startsWith(ignorePath.slice(0, -1));
    }
    // 部分マッチ
    return urlPath.includes(ignorePath);
  });
}

/**
 * リンククラスセレクタを正規化
 * @param linkClass - ユーザー入力のクラス名
 * @returns CSSセレクタ形式のクラス名
 */
export function normalizeClassSelector(linkClass: string): string {
  // 既に "." で始まる場合はそのまま
  if (linkClass.startsWith('.')) {
    return linkClass;
  }
  // "a." で始まる場合はそのまま
  if (linkClass.startsWith('a.')) {
    return linkClass;
  }
  // それ以外は "." を追加
  return `.${linkClass}`;
}

/**
 * URLを正規化（重複防止用）
 * @param url - 正規化するURL
 * @returns 正規化されたURL
 */
export function normalizeUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

/**
 * 相対URLを絶対URLに変換
 * @param href - 変換するURL（相対または絶対）
 * @param baseUrl - ベースURL
 * @returns 絶対URL、失敗時はnull
 */
export function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * URLが有効なHTTP/HTTPSかチェック
 * @param url - チェックするURL
 * @returns 有効な場合true
 */
export function isValidHttpUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return ['http:', 'https:'].includes(parsedUrl.protocol);
  } catch {
    return false;
  }
}

