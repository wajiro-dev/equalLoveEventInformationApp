# Node.js 20 LTSを使用
FROM node:20-alpine

# 作業ディレクトリを設定
WORKDIR /app

# package.jsonをコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm ci --only=production

# アプリケーションコードをコピー
COPY . .

# ポート3000を公開
EXPOSE 3000

# アプリケーションを起動
CMD ["npm", "start"]
