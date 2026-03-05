# Frontend Dockerfile
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Build arguments (for production build)
ARG VITE_API_URL

# Copy package files first for layer caching
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy application code
COPY . .

# Build the application
RUN npm run build

# Multi-stage build: switch to nginx for production
FROM nginx:alpine

# Copy built files
COPY --from=0 /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 5173

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
