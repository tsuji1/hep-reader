# Build stage for React client
FROM node:iron-trixie-slim AS client-builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Production stage

FROM node:20.19.6

# Install pandoc
RUN apt-get update && apt-get install -y pandoc && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy server files
COPY package*.json ./
COPY server/ ./server/

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

CMD ["node", "server/index.js"]
