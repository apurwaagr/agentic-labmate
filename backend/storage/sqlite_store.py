import sqlite3
import json
import os
from pathlib import Path

# DB file in the backend directory
DB_PATH = Path(__file__).parent.parent / "data" / "labmate.db"

def _get_connection():
    os.makedirs(DB_PATH.parent, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = _get_connection()
    try:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                experimentId TEXT NOT NULL,
                section TEXT NOT NULL,
                reviewer TEXT NOT NULL,
                correction TEXT NOT NULL,
                severity TEXT NOT NULL,
                domain TEXT,
                hypothesis TEXT,
                tags TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()
    finally:
        conn.close()

def save_review(review_data: dict) -> dict:
    conn = _get_connection()
    try:
        tags_json = json.dumps(review_data.get("tags", []))
        cursor = conn.execute('''
            INSERT INTO reviews (experimentId, section, reviewer, correction, severity, domain, hypothesis, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            review_data["experimentId"],
            review_data["section"],
            review_data["reviewer"],
            review_data["correction"],
            review_data["severity"],
            review_data.get("domain"),
            review_data.get("hypothesis"),
            tags_json
        ))
        conn.commit()
        review_data["id"] = cursor.lastrowid
        return review_data
    finally:
        conn.close()

def get_reviews(experimentId: str = None):
    conn = _get_connection()
    try:
        if experimentId:
            cursor = conn.execute('SELECT * FROM reviews WHERE experimentId = ? ORDER BY created_at DESC', (experimentId,))
        else:
            cursor = conn.execute('SELECT * FROM reviews ORDER BY created_at DESC')
        
        rows = cursor.fetchall()
        reviews = []
        for row in rows:
            reviews.append({
                "experimentId": row["experimentId"],
                "section": row["section"],
                "reviewer": row["reviewer"],
                "correction": row["correction"],
                "severity": row["severity"],
                "domain": row["domain"],
                "hypothesis": row["hypothesis"],
                "tags": json.loads(row["tags"]) if row["tags"] else []
            })
        return reviews
    finally:
        conn.close()
