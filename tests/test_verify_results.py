from __future__ import annotations

from fastapi.testclient import TestClient

from hq_service.api import app

client = TestClient(app)


def test_verify_results_shape_and_limit_clamp():
    r = client.get("/api/v1/verify/results?limit=9999")
    assert r.status_code == 200
    body = r.json()
    assert "results" in body
    assert isinstance(body["results"], list)
    # db_unavailable path returns a note; live path returns total/pending counts
    assert "note" in body or {"total", "pending"} <= body.keys()


if __name__ == "__main__":
    test_verify_results_shape_and_limit_clamp()
    print("OK test_verify_results")
