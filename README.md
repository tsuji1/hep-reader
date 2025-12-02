# 📚 EPUB HTML Viewer

EPUBファイルをHTMLに変換してブラウザで閲覧できるセルフホスト型Webアプリケーションです。

## 概要

EPUB形式の電子書籍をpandocでHTMLに変換し、快適な読書体験を提供します。縦スクロールとページ切り替えの両方のモードに対応し、しおりや読書進捗の保存機能も備えています。また、書籍ごとに言語設定ができるため、ブラウザの翻訳機能と組み合わせて外国語の本を日本語で読むことも可能です。

### 主な特徴

- 🔄 **EPUB→HTML変換**: pandocを使用した高品質な変換
- 📜 **2つの閲覧モード**: 縦スクロール / ページ切り替え
- 🔖 **しおり機能**: メモ付きで任意のページをブックマーク
- 📊 **進捗保存**: 読んだ位置を自動保存、次回続きから再開
- 🌐 **多言語対応**: 言語設定により翻訳拡張機能との連携が可能
- 📱 **レスポンシブ**: PC・タブレット・スマホ対応

## スクリーンショット

### ライブラリ画面
- 書籍一覧の表示（カバー画像、タイトル、進捗バー）
- ドラッグ＆ドロップでEPUBをアップロード
- 並び替え（最終閲覧日時/タイトル/追加日時）
- 書籍ごとの設定編集（タイトル、言語）

### リーダー画面
- 目次・しおりのサイドバー
- スクロールモード / ページモード切り替え
- ページジャンプ機能

## 必要環境

- **Docker** および **Docker Compose**（推奨）
- または Node.js 18+ と pandoc

## セットアップ

### Docker（推奨）

```bash
# リポジトリをクローン
git clone <repository-url>
cd epub-html-viewer

# 起動
docker compose up -d

# アクセス
open http://localhost:10300
```

### ローカル開発

```bash
# pandocのインストール
# Ubuntu/Debian
sudo apt install pandoc
# macOS
brew install pandoc
# Windows
winget install pandoc

# 依存関係のインストール
npm run install:all

# 開発サーバー起動
npm run dev

# アクセス
open http://localhost:3000
```

## 使い方

### 1. 書籍のアップロード

1. ブラウザで http://localhost:10300 にアクセス
2. EPUBファイルをドラッグ＆ドロップ、またはクリックして選択
3. 自動的にHTMLに変換され、ライブラリに追加されます

### 2. 書籍の閲覧

1. ライブラリから読みたい本をクリック
2. 閲覧モードを選択
   - 📜 **スクロールモード**: 全ページを縦スクロールで連続表示
   - 📄 **ページモード**: 1ページずつ表示、前へ/次へで移動

### 3. しおり機能

1. 保存したいページで「📑 しおり」ボタンをクリック
2. 任意でメモを追加して保存
3. サイドバーの「しおり」タブから一覧を確認・移動

### 4. 書籍設定の編集

1. ライブラリで書籍カードにホバー
2. ⚙ ボタンをクリック
3. タイトルや言語を変更して保存

### 5. 翻訳機能の活用

1. 書籍の言語を「英語」など原文の言語に設定
2. ブラウザの翻訳拡張機能（例: Google翻訳）を有効化
3. 自動的に日本語に翻訳されます

## 技術仕様

### アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│                   Client (React)                │
│  ┌─────────┐  ┌─────────┐  ┌─────────────────┐  │
│  │  Home   │  │ Reader  │  │   Components    │  │
│  └─────────┘  └─────────┘  └─────────────────┘  │
└─────────────────────┬───────────────────────────┘
                      │ HTTP/REST API
┌─────────────────────▼───────────────────────────┐
│                 Server (Express)                │
│  ┌─────────┐  ┌─────────┐  ┌─────────────────┐  │
│  │  API    │  │ pandoc  │  │    Database     │  │
│  │ Routes  │  │ convert │  │   (SQLite)      │  │
│  └─────────┘  └─────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React 18, Vite, React Router |
| バックエンド | Node.js, Express.js |
| データベース | SQLite (better-sqlite3) |
| 変換エンジン | pandoc |
| コンテナ | Docker, Docker Compose |

### ディレクトリ構造

```
epub-html-viewer/
├── client/                 # Reactフロントエンド
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.jsx    # ライブラリ画面
│   │   │   └── Reader.jsx  # リーダー画面
│   │   ├── App.jsx         # ルーティング
│   │   ├── index.css       # スタイル
│   │   └── main.jsx        # エントリーポイント
│   ├── package.json
│   └── vite.config.js
├── server/                 # Expressバックエンド
│   ├── index.js            # APIサーバー
│   └── database.js         # DB操作
├── data/                   # SQLiteデータベース
├── uploads/                # アップロード一時保存
├── converted/              # 変換済みHTMLファイル
│   └── {bookId}/
│       ├── pages/          # ページ別HTML
│       ├── media/          # 画像等
│       └── pages.json      # ページ情報
├── docker-compose.yml
├── Dockerfile
└── package.json
```

### データベーススキーマ

```sql
-- 書籍テーブル
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_filename TEXT,
  total_pages INTEGER DEFAULT 1,
  category TEXT,
  language TEXT DEFAULT 'en',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- しおりテーブル
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  page_num INTEGER NOT NULL,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

-- 読書進捗テーブル
CREATE TABLE reading_progress (
  book_id TEXT PRIMARY KEY,
  current_page INTEGER DEFAULT 1,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
```

### API リファレンス

| Method | Endpoint | 説明 |
|--------|----------|------|
| **書籍管理** |||
| POST | `/api/upload` | EPUBアップロード・変換 |
| GET | `/api/books` | 書籍一覧取得 |
| GET | `/api/books/:id` | 書籍詳細取得 |
| PATCH | `/api/books/:id` | 書籍情報更新（タイトル、言語） |
| DELETE | `/api/books/:id` | 書籍削除 |
| **コンテンツ** |||
| GET | `/api/books/:id/page/:num` | 指定ページ取得 |
| GET | `/api/books/:id/all-pages` | 全ページ取得 |
| GET | `/api/books/:id/toc` | 目次取得 |
| GET | `/api/books/:id/cover` | カバー画像取得 |
| GET | `/api/books/:id/media/*` | メディアファイル取得 |
| **しおり** |||
| GET | `/api/books/:id/bookmarks` | しおり一覧取得 |
| POST | `/api/books/:id/bookmarks` | しおり追加 |
| DELETE | `/api/bookmarks/:id` | しおり削除 |
| **進捗** |||
| GET | `/api/books/:id/progress` | 読書進捗取得 |
| POST | `/api/books/:id/progress` | 読書進捗保存 |

### 環境変数

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `PORT` | 3001 | サーバーポート |
| `NODE_ENV` | development | 環境（production/development） |

## トラブルシューティング

### 変換に失敗する
- pandocがインストールされているか確認
- EPUBファイルが破損していないか確認

### 翻訳が動作しない
- 書籍の言語設定を確認（原文の言語に設定）
- ブラウザの翻訳拡張機能が有効か確認

### 画像が表示されない
- 開発者ツールでネットワークエラーを確認
- `/api/books/:id/media/` へのアクセスが正常か確認

## ライセンス

MIT License
