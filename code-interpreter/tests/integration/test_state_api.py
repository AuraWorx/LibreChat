"""Integration tests guarding the intentionally absent public /state API."""

import pytest
from fastapi.testclient import TestClient

from src.main import app


@pytest.fixture
def client():
    """Create a test client."""
    return TestClient(app)


@pytest.fixture
def auth_headers():
    """Provide authentication headers for tests."""
    return {"x-api-key": "test-api-key-for-testing-12345"}


class TestStateApiSurface:
    """Verify that state persistence remains internal-only."""

    def test_state_routes_are_not_registered(self):
        """No public /state routes should be mounted."""
        state_paths = [
            route.path
            for route in app.routes
            if getattr(route, "path", "").startswith("/state")
        ]

        assert state_paths == []

    def test_get_state_endpoint_returns_404(self, client, auth_headers):
        """Direct state downloads are not part of the public API."""
        response = client.get("/state/test-session", headers=auth_headers)

        assert response.status_code == 404

    def test_get_state_info_endpoint_returns_404(self, client, auth_headers):
        """State metadata is not exposed over HTTP."""
        response = client.get("/state/test-session/info", headers=auth_headers)

        assert response.status_code == 404

    def test_delete_state_endpoint_returns_404(self, client, auth_headers):
        """State deletion happens through internal services, not public routes."""
        response = client.delete("/state/test-session", headers=auth_headers)

        assert response.status_code == 404
