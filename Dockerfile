FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache python3 make g++

# ─── Install dependencies ─────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci --include=dev

# ─── Build client ─────────────────────────────────────────────────────────────
FROM deps AS build-client
COPY . .
RUN npm run build:client

# ─── Build server ─────────────────────────────────────────────────────────────
FROM deps AS build-server
COPY . .
RUN npm run build:server

# ─── Production image ─────────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build-client /app/dist/client ./dist/client
COPY --from=build-server /app/dist/server ./dist/server

EXPOSE 3000
ENV NODE_ENV=production

VOLUME ["/app/data"]

CMD ["node", "dist/server/index.js"]
