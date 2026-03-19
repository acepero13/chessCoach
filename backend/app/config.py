from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    backend_port: int = 8000
    frontend_port: int = 5173

    database_url: str = "sqlite+aiosqlite:///./chess_tutor.db"
    stockfish_path: str = "/usr/bin/stockfish"
    stockfish_depth: int = 18
    stockfish_threads: int = 4
    stockfish_hash_mb: int = 256

    ollama_host: str = "http://localhost:11434"
    #ollama_model: str = "gemma3:12b"
    #ollama_model: str = "qwen-optimized:latest"
    ollama_model: str = "qwen3.5:9b"

    lichess_api_base: str = "https://lichess.org/api"
    chessdotcom_api_base: str = "https://api.chess.com/pub"

    analysis_batch_size: int = 40
    analysis_depth: int = 18

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
