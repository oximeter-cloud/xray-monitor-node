# Build Stage
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src/ ./src/
RUN npm run build

# Production Stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
# No external runtime dependencies needed, pure node standard library!

COPY --from=builder /app/dist ./dist

# Non-root user with read access or root if mounted logs require root permissions
USER root

CMD ["node", "dist/index.js"]
