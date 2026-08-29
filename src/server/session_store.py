"""Small durable store for local chess sessions.

This is deliberately local-only: it stores game metadata, SAN moves, and the
coach transcript in SQLite under ``data/``. API credentials are never part of
the session payload.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any


class SessionStore:
    def __init__(self, path: str):
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self._path) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS chess_sessions (
                    session_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    updated_at REAL NOT NULL
                )
                """
            )
            connection.commit()

    def save(self, session_id: str, payload: dict[str, Any]) -> None:
        with sqlite3.connect(self._path) as connection:
            connection.execute(
                """
                INSERT INTO chess_sessions(session_id, payload, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    payload=excluded.payload,
                    updated_at=excluded.updated_at
                """,
                (session_id, json.dumps(payload), time.time()),
            )
            connection.commit()

    def load_all(self) -> list[tuple[str, dict[str, Any]]]:
        with sqlite3.connect(self._path) as connection:
            rows = connection.execute(
                "SELECT session_id, payload FROM chess_sessions ORDER BY updated_at DESC"
            ).fetchall()
        sessions: list[tuple[str, dict[str, Any]]] = []
        for session_id, payload in rows:
            try:
                data = json.loads(payload)
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(data, dict):
                sessions.append((session_id, data))
        return sessions
