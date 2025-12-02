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

## デプロイ

**重要: デプロイ前に必ずテストを実行すること！**

コード変更後は必ずテスト → Dockerを再ビルドしてデプロイする:

```bash
# 1. テスト実行（必須 - これが通らないとデプロイしない）
npm test

# 2. コミット
git add -A && git commit -m "feat: 変更内容"

# 3. Dockerデプロイ（再ビルド）
docker compose down && docker compose build --no-cache && docker compose up -d

# 4. 動作確認
open http://localhost:10300
```

**クイックデプロイ（キャッシュ使用）:**
```bash
npm test && docker compose up -d --build
```

**ログ確認:**
```bash
docker compose logs -f epub-viewer
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

**重要: 機能追加・バグ修正は必ずテストファーストで行うこと！**

### 開発の鉄則

1. **テストを書いてから実装する** - 実装前に必ずテストを書く
2. **テストが通ってからデプロイする** - `npm test` が全てパスしてからDockerデプロイ
3. **APIの変更は `server/api.test.js` でテストする** - supertestを使った統合テスト

### TDDサイクル (Red → Green → Refactor)

1. **Red**: 失敗するテストを最小限で書く
2. **Green**: テストを通す最小限のコードを書く
3. **Refactor**: 重複除去・設計改善 (テストは緑のまま)

### テスト実行コマンド

```bash
# バックエンドテスト（必須）
npm test

# フロントエンドテスト
cd client && npm test

# 全テスト実行
npm run test:all

# ウォッチモード (開発中)
npm run test:watch
```

### テストファイル構成

| ファイル | 内容 |
|---------|------|
| `server/api.test.js` | API統合テスト (supertest) |
| `server/database.test.js` | DB操作 (books, bookmarks, progress) |
| `client/src/utils/reader.test.js` | ユーティリティ関数 |
| `client/src/utils/reader.js` | テスト可能な純粋関数を抽出 |

### テストツールスタック

- **Vitest**: テストランナー (Jest互換、Vite統合)
- **supertest**: API統合テスト用
- **@testing-library/react**: Reactコンポーネントテスト

### 新機能追加時のTDDフロー（必須）

```bash
# 1. Red: 失敗するテストを書く
# server/api.test.js または server/database.test.js に追加
it('should do something new', () => {
  expect(result).toBe(expected)
})

# 2. テスト実行 → 失敗確認
npm test

# 3. Green: 最小限の実装
# server/index.js または server/database.js に実装

# 4. テスト実行 → 成功確認（必須！）
npm test

# 5. Refactor: コード改善

# 6. 全テスト通過を確認してからデプロイ
npm test && docker compose up -d --build

# 7. コミット
git add -A && git commit -m "feat: add new function"
```

### バグ修正時のTDDフロー（必須）

```bash
# 1. バグを再現するテストを書く
it('should handle edge case X', () => {
  // バグが発生する条件を再現
})

# 2. テスト実行 → 失敗確認（バグの存在を証明）
npm test

# 3. バグを修正

# 4. テスト実行 → 成功確認（修正の証明）
npm test

# 5. デプロイ
docker compose up -d --build
```

## Git運用

こまめにコミットする:
```bash
git add -A && git commit -m "feat: 機能説明" # 機能追加
git add -A && git commit -m "fix: バグ説明"  # バグ修正
git add -A && git commit -m "refactor: 説明" # リファクタ
git add -A && git commit -m "test: 説明"     # テスト追加
```

## データベースバックアップ

SQLiteデータベースは定期的にバックアップを取ること:

```bash
# 手動バックアップ（タイムスタンプ付き）
cp data/epub-viewer.db data/epub-viewer.db.backup.$(date +%Y%m%d_%H%M%S)

# バックアップ一覧確認
ls -la data/*.backup.*
```

**バックアップタイミング:**
- 大きな機能追加・変更の前
- デプロイ前
- データ移行作業の前

**リストア方法:**
```bash
cp data/epub-viewer.db.backup.YYYYMMDD_HHMMSS data/epub-viewer.db
```

## トラブルシューティング

| 問題 | 確認ポイント |
|------|-------------|
| 変換失敗 | `which pandoc` で存在確認 |
| 画像非表示 | `/api/books/:id/media/*` ルートとファイル存在確認 |
| DB接続エラー | `data/` ディレクトリの権限確認 |
| CORS | `server/index.js` の `cors()` 設定確認 |
