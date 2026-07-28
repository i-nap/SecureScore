"""
tests/unit/test_jwt.py — Unit tests for JWT creation and verification.
"""

import os
import sys
import json
import base64
import hashlib
import hmac
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest

# Ensure env before import
os.environ.setdefault("HQ_BRANCH_API_KEY", "test-api-key-fixture")
os.environ.setdefault("HQ_SECRET_KEY", "test-jwt-secret-fixture-32chars!!")

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from hq_server import _create_jwt, _verify_jwt


class TestJWTCreation:

    def test_create_jwt_returns_three_parts(self):
        token, exp = _create_jwt("Kathmandu", "branch_operator")
        parts = token.split(".")
        assert len(parts) == 3, "JWT must have header.payload.signature"

    def test_create_jwt_payload_contains_expected_claims(self):
        token, exp = _create_jwt("Pokhara", "admin")
        payload_b = token.split(".")[1]
        padded = payload_b + "=" * (-len(payload_b) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
        assert claims["branch"] == "Pokhara"
        assert claims["role"] == "admin"
        assert "iat" in claims
        assert "exp" in claims

    def test_create_jwt_expiry_is_future(self):
        token, exp = _create_jwt("Sarlahi", "viewer")
        payload_b = token.split(".")[1]
        padded = payload_b + "=" * (-len(payload_b) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
        assert claims["exp"] > time.time(), "Token must expire in the future"

    def test_create_jwt_different_roles_produce_different_tokens(self):
        token_admin, _ = _create_jwt("HQ", "admin")
        token_viewer, _ = _create_jwt("HQ", "viewer")
        assert token_admin != token_viewer


class TestJWTVerification:

    def test_valid_token_verifies_successfully(self, branch_token, jwt_secret):
        claims = _verify_jwt(branch_token)
        assert claims["branch"] == "Kathmandu"
        assert claims["role"] == "branch_operator"

    def test_expired_token_raises_value_error(self, expired_token):
        with pytest.raises(ValueError, match="expired"):
            _verify_jwt(expired_token)

    def test_tampered_payload_raises_value_error(self, branch_token):
        parts = branch_token.split(".")
        # Tamper the payload
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
        claims["role"] = "admin"  # privilege escalation attempt
        tampered_payload = base64.urlsafe_b64encode(
            json.dumps(claims).encode()
        ).rstrip(b"=").decode()
        tampered_token = f"{parts[0]}.{tampered_payload}.{parts[2]}"
        with pytest.raises(ValueError, match="Invalid signature"):
            _verify_jwt(tampered_token)

    def test_malformed_token_raises_value_error(self):
        with pytest.raises(ValueError, match="Malformed"):
            _verify_jwt("not.a.valid.jwt.token")

    def test_wrong_secret_raises_value_error(self, jwt_secret):
        from hq_server import _create_jwt as make
        token, _ = make("HQ", "admin")
        # Verify with wrong secret by patching
        import hq_server
        original_secret = hq_server.JWT_SECRET
        hq_server.JWT_SECRET = "wrong-secret-entirely"
        try:
            with pytest.raises(ValueError):
                hq_server._verify_jwt(token)
        finally:
            hq_server.JWT_SECRET = original_secret

    def test_round_trip_create_and_verify(self):
        token, _ = _create_jwt("Birgunj", "branch_operator")
        claims = _verify_jwt(token)
        assert claims["branch"] == "Birgunj"
        assert claims["role"] == "branch_operator"
