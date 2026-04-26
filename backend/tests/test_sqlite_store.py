import pytest
from backend.storage.sqlite_store import init_db, save_review, get_reviews
import os
from pathlib import Path

def test_sqlite_persistence(tmp_path):
    # Change DB path temporarily for testing
    import backend.storage.sqlite_store
    backend.storage.sqlite_store.DB_PATH = tmp_path / "test.db"
    
    init_db()
    
    # Save a review
    record = {
        "experimentId": "exp-123",
        "section": "Validation",
        "reviewer": "Test Reviewer",
        "correction": "This is a test correction",
        "severity": "major"
    }
    saved = save_review(record)
    assert saved.get("id") is not None
    
    # Retrieve reviews
    reviews = get_reviews("exp-123")
    assert len(reviews) == 1
    assert reviews[0]["correction"] == "This is a test correction"
    
    # Retrieve all
    all_reviews = get_reviews()
    assert len(all_reviews) == 1
