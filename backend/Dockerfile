# Backend Dockerfile
FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install curl and wget for Stockfish download
RUN apt-get update && apt-get install -y curl wget && rm -rf /var/lib/apt/lists/*

# Install Stockfish only if not present on host
RUN (! which stockfish 2>/dev/null) && wget -qO- https://github.com/official-stockfish/Stockfish/releases/download/v18.0/stockfish-18.0-linux-x64.tar.xz | tar -C /tmp -xJ && mv /tmp/stockfish-18.0-linux-x64 /usr/bin/stockfish && chmod +x /usr/bin/stockfish && rm -rf /tmp/stockfish-18.0-linux-x64 stockfish-18.0-linux-x64.tar.xz || true

# Copy requirements first for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Run the application
CMD ["bash", "run.sh"]
