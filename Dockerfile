# Build stage
FROM node:22-alpine AS builder

# Build arguments for frontend configuration (baked into the bundle at build time)
# These can be overridden with --build-arg when running docker build
ARG AZTEC_NODE_URL=http://localhost:8080
ARG API_BASE_URL=
# API_URL is only used by webpack dev server proxy (not needed in production)
ARG API_URL=http://localhost:3001

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

# Create .env file from build args for dotenv-webpack to pick up
RUN echo "AZTEC_NODE_URL=${AZTEC_NODE_URL}" > .env && \
    echo "API_BASE_URL=${API_BASE_URL}" >> .env && \
    echo "API_URL=${API_URL}" >> .env

# Build frontend (uses .env values via dotenv-webpack)
RUN npm run build

# Production stage for backend (using Ubuntu 24.04 for GLIBCXX_3.4.32 required by @aztec/bb.js)
FROM ubuntu:24.04 AS backend

# Install Node.js 22, git, and required libraries
RUN apt-get update && \
    apt-get install -y curl git libstdc++6 && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/* && \
    npm install -g husky

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
