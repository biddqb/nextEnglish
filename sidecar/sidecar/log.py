"""Loguru config. Mirrors src-tauri/src/log.rs in shape (different runtime).
Both write to app_data_dir/logs/ in production. Tail both during debugging."""
from __future__ import annotations
import sys
from pathlib import Path
from loguru import logger


def init_logging(log_dir: Path | None = None, level: str = "INFO") -> None:
    logger.remove()
    logger.add(
        sys.stderr,
        level=level,
        format="<green>{time:HH:mm:ss}</green> <level>{level: <8}</level> <cyan>{module}</cyan> {message}",
    )
    if log_dir is not None:
        log_dir.mkdir(parents=True, exist_ok=True)
        logger.add(
            log_dir / "nextenglish.py.log",
            rotation="10 MB",
            retention=5,
            level="DEBUG",
            format="{time:YYYY-MM-DD HH:mm:ss.SSS} {level: <8} {module}:{function}:{line} {message}",
        )
