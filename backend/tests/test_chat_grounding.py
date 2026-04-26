import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_chat_grounding_fallback():
    # If Vertex is not properly configured, it should fallback
    req = {
        "question": "What is the primary metric?",
        "hypothesis": "Test hypothesis",
        "planContext": {"domain": "Test Domain"}
    }
    response = client.post("/api/chat", json=req)
    assert response.status_code == 200
    data = response.json()
    assert "answer" in data
    assert "citations" in data
    assert data["mode"] in ["grounded", "fallback"]

def test_chat_grounding_fields():
    req = {
        "question": "What is the primary metric?",
        "hypothesis": "Test hypothesis",
        "planContext": {"domain": "Test Domain"}
    }
    response = client.post("/api/chat", json=req)
    data = response.json()
    assert isinstance(data["citations"], list)
    assert isinstance(data["followUps"], list)
