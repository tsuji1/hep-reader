# Build stage for React client
FROM node:iron-trixie-slim AS client-builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Build stage for TypeScript server
FROM node:iron-trixie-slim AS server-builder

# Install Python for better-sqlite3 native module compilation
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY server/ ./server/
RUN npm run build:server

# Production stage

FROM node:20.19.6

# Install pandoc, poppler-utils (for pdftoppm), and Japanese fonts
RUN apt-get update && apt-get install -y \
    pandoc \
    poppler-utils \
    fonts-noto-cjk \
    fonts-noto-cjk-extra \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -fv

WORKDIR /app

# Copy server files (compiled JS)
COPY package*.json ./
COPY --from=server-builder /app/server/dist ./server/dist/

# Install server dependencies only
RUN npm install --omit=dev

# Copy built client
COPY --from=client-builder /app/client/dist ./client/dist

# Create directories for data
RUN mkdir -p data converted uploads

# Expose port
EXPOSE 10300

ENV PORT=10300
ENV NODE_ENV=production

CMD ["node", "server/dist/index.js"]
