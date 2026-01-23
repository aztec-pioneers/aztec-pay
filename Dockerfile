# Build stage
FROM node:22-alpine AS builder

# Install git (needed for GitHub dependencies) and husky globally (for postinstall scripts)
RUN apk add --no-cache git && npm install -g husky

WORKDIR /app

# Copy package files
COPY package.json yarn.lock* package-lock.json* ./

# Install dependencies
RUN npm install

# Copy pre-built aztec-standards artifacts and target (not included in GitHub repo)
COPY docker-assets/aztec-standards-artifacts ./node_modules/@defi-wonderland/aztec-standards/artifacts
COPY docker-assets/aztec-standards-target ./node_modules/@defi-wonderland/aztec-standards/target

# Copy source code
COPY . .

# Build frontend
RUN npm run build

# Production stage for backend (using slim for glibc compatibility with Aztec native modules)
FROM node:22-slim AS backend

# Install git (needed for GitHub dependencies) and husky globally (for postinstall scripts)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/* && npm install -g husky

WORKDIR /app

# Copy package files and install production dependencies
COPY package.json yarn.lock* package-lock.json* ./

# Install dependencies
RUN npm install

# Copy pre-built aztec-standards artifacts and target (not included in GitHub repo)
COPY docker-assets/aztec-standards-artifacts ./node_modules/@defi-wonderland/aztec-standards/artifacts
COPY docker-assets/aztec-standards-target ./node_modules/@defi-wonderland/aztec-standards/target

# Copy source code (needed for tsx to run TypeScript)
COPY src ./src
COPY tsconfig.json ./

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Expose backend port
EXPOSE 3001

ENV PORT=3001
ENV NODE_ENV=production

# Run the server
CMD ["npx", "tsx", "src/ts/server.ts"]

# Frontend stage (for serving static files with nginx)
FROM nginx:alpine AS frontend

# Copy built frontend files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
