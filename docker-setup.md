# ChessTutor Docker Setup

This document explains how to dockerize the ChessTutor application.

## Prerequisites

- Docker Engine 20.10.0+
- Docker Compose (usually included with Docker Engine)
- Optional: Ollama for LLM functionality

## Project Structure

```
ChessTutor/
├── backend/
│   ├── Dockerfile          # Backend container
│   ├── requirements.txt    # Python dependencies
│   └── run.sh             # Startup script
├── frontend/
│   ├── Dockerfile          # Frontend container
│   ├── nginx.conf          # Nginx config
│   └── package.json
├── docker-compose.yml      # Compose configuration
└── docker-setup.md         # This file
```

## Quick Start

### Start All Services

```bash
cd /home/alvaro/PycharmProjects/ChessTutor
docker compose up -d --build
```

### Available Ports

| Service  | Port | URL                  |
|----------|------|----------------------|
| Backend  | 8000 | http://localhost:8000|
| Frontend | 5173 | http://localhost:5173|
| Ollama   | 11434| http://localhost:11434|

### Health Check

```bash
curl http://localhost:8000/health
```

### Stop All Services

```bash
docker-compose down
```

### Cleanup Volumes (optional)

```bash
docker-compose down -v
```

## Service Details

### Backend Service

- **Image**: Built from `backend/Dockerfile`
- **Ports**: 8000
- **Dependencies**:
  - Stockfish (auto-installed if missing)
  - Ollama (optional, for LLM features)
- **Volumes**:
  - SQLite database persists in volume

### Frontend Service

- **Image**: Built from `frontend/Dockerfile`
- **Ports**: 5173
- **Build Args**: VITE_API_URL (set via environment)
- **Serves**: Production build of React app

### Ollama Service (Optional)

- **Image**: `ollama/ollama:latest`
- **Ports**: 11434
- **Volumes**: Model cache

## Customization

### Modify Backend Port

Edit `docker-compose.yml`:

```yaml
backend:
  ports:
    - "8080:8000"  # Host:Container
```

### Modify Ollama Model

Edit `backend/app/config.py`:

```python
ollama_model: str = "qwen3.5:9b"
```

Then pull the model:

```bash
docker exec chess-tutor-ollama ollama pull qwen3.5:9b
```

## Development Mode

For development with hot-reload, modify `docker-compose.yml`:

```yaml
services:
  backend:
    volumes:
      - ./backend:/app  # Mount entire backend folder
    # Remove --build flag to rebuild on changes
```

## Troubleshooting

### Backend won't start

```bash
# Check logs
docker-compose logs backend

# Rebuild backend
docker-compose up -d --build backend
```

### Ollama not responding

```bash
# Pull required model
docker exec -it chess-tutor-ollama ollama pull qwen3.5:9b

# Check Ollama status
docker exec chess-tutor-ollama ollama list
```

### Database issues

```bash
# Remove and recreate database
docker-compose down -v
docker-compose up -d
```

### Access from outside host network

```bash
# Remove internal network binding
docker-compose up -d \
  -e VITE_API_URL=http://<host-ip>:8000
```

## Building Images Manually

```bash
# Build backend only
cd backend
docker build -t chess-tutor-backend .

# Build frontend only
cd ../frontend
docker build -t chess-tutor-frontend .

# Run without compose
docker run -p 8000:8000 chess-tutor-backend
docker run -p 5173:5173 chess-tutor-frontend
```

## Environment Variables

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| DATABASE_URL | sqlite+aiosqlite:///./chess_tutor.db | SQLite path |
| STOCKFISH_PATH | /usr/bin/stockfish | Stockfish binary |
| OLLAMA_HOST | http://localhost:11434 | Ollama API |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| VITE_API_URL | http://localhost:8000 | Backend API URL |

## CI/CD Example

```yml
# .github/workflows/docker-build.yml
name: Build and Deploy

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2

      - name: Build and push
        uses: docker/build-push-action@v4
        with:
          context: .
          push: true
          tags: chesstutor/backend:latest
```

## License

Part of ChessTutor project.
