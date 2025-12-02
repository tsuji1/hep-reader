# EPUB HTML Viewer - AI開発ガイドライン

## アーキテクチャ概要

このプロジェクトは **EPUB → HTML変換ビューア** で、3層構成を採用:

```
Client (React/Vite:3000) ──API──> Server (Express:3001) ──pandoc──> converted/{bookId}/
          ↓ proxy                    ↓
         /api/* → :3001          SQLite (data/epub-viewer.db)
```

**データフロー**: EPUB upload → pandoc変換 → HTMLをページ分割 → `converted/{uuid}/pages/` に保存

## 重要なファイル構造

| パス | 役割 |
|------|------|
| `server/index.js` | Express API & EPUB変換ロジック (splitIntoPages) |
| `server/database.js` | SQLite操作 (better-sqlite3, 同期API) |
| `client/src/pages/Home.jsx` | ライブラリ画面 (アップロード/一覧) |
| `client/src/pages/Reader.jsx` | リーダー画面 (スクロール/ページモード) |
| `import-epub.js` | 一括インポートCLI (`node import-epub.js [dir]`) |

## 開発コマンド

```bash
# 依存インストール (root + client両方)
npm run install:all

# 開発サーバー起動 (concurrently: server + vite)
npm run dev

# Docker起動 (本番ポート: 10300)
docker compose up -d
```

## コード規約

### バックエンド (server/)
- **同期DB API使用**: `db.prepare().run()` / `.get()` / `.all()` - コールバック不要
- **パス**: 必ず `path.join(__dirname, '../...')` で相対パス解決
- **エラーハンドリング**: try-catch でラップし `res.status(500).json({ error: message })`
- **新規API追加時**: `server/database.js`にDB操作関数を追加 → `server/index.js`でルート定義

### フロントエンド (client/src/)
- **React 18 + Vite**: JSX拡張子、ES modules
- **状態管理**: useState/useEffect のみ (Redux等は不使用)
- **API呼び出し**: axios使用、エラーはconsole.error + alert表示
- **スタイル**: `client/src/index.css` に全CSS集約 (CSS-in-JS不使用)

### 画像パス修正パターン (Reader.jsx)
```javascript
// EPUB内の画像パスをAPI経由に変換
content
  .replace(/src="\/home\/[^"]*\/media\//g, `src="/api/books/${bookId}/media/`)
  .replace(/src="media\//g, `src="/api/books/${bookId}/media/`)
```

## DBスキーマ (SQLite)

```sql
books (id TEXT PK, title, original_filename, total_pages, category, language, created_at, updated_at)
bookmarks (id TEXT PK, book_id FK, page_num, note, created_at)
reading_progress (book_id TEXT PK, current_page, updated_at)
```

**マイグレーション例** (`server/database.js`):
```javascript
try { db.exec(`ALTER TABLE books ADD COLUMN language TEXT DEFAULT 'en'`); } catch(e) {}
```

## TDD開発ガイドライン (t-wada style)

テスト追加時は以下のサイクルを遵守:

1. **Red**: 失敗するテストを最小限で書く
2. **Green**: テストを通す最小限のコードを書く
3. **Refactor**: 重複除去・設計改善 (テストは緑のまま)

```bash
# テスト実行 (要: package.jsonにtest script追加)
npm test
```

**テストファイル命名**: `*.test.js` または `__tests__/*.js`

## Git運用

こまめにコミットする:
```bash
git add -A && git commit -m "feat: 機能説明" # 機能追加
git add -A && git commit -m "fix: バグ説明"  # バグ修正
git add -A && git commit -m "refactor: 説明" # リファクタ
git add -A && git commit -m "test: 説明"     # テスト追加
```

## トラブルシューティング

| 問題 | 確認ポイント |
|------|-------------|
| 変換失敗 | `which pandoc` で存在確認 |
| 画像非表示 | `/api/books/:id/media/*` ルートとファイル存在確認 |
| DB接続エラー | `data/` ディレクトリの権限確認 |
| CORS | `server/index.js` の `cors()` 設定確認 |
