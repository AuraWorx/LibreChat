"""Unit tests for the StateService."""

import base64
import hashlib
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.services.state import StateService


@pytest.fixture
def mock_redis_client():
    """Mock Redis client."""
    client = AsyncMock()
    client.get = AsyncMock(return_value=None)
    client.setex = AsyncMock()
    client.delete = AsyncMock()
    client.strlen = AsyncMock(return_value=0)
    client.ttl = AsyncMock(return_value=-1)
    client.expire = AsyncMock()
    client.pipeline = MagicMock()
    return client


@pytest.fixture
def state_service(mock_redis_client):
    """Create StateService with mocked Redis."""
    with patch("src.services.state.redis_pool") as mock_pool:
        mock_pool.get_client.return_value = mock_redis_client
        service = StateService(redis_client=mock_redis_client)
        return service


class TestComputeHash:
    """Tests for hash computation."""

    def test_compute_hash_returns_sha256(self):
        """Test that compute_hash returns SHA256 hex digest."""
        raw_bytes = b"test data for hashing"
        expected = hashlib.sha256(raw_bytes).hexdigest()

        result = StateService.compute_hash(raw_bytes)

        assert result == expected

    def test_compute_hash_is_deterministic(self):
        """Test that same input produces same hash."""
        raw_bytes = b"reproducible test data"

        hash1 = StateService.compute_hash(raw_bytes)
        hash2 = StateService.compute_hash(raw_bytes)

        assert hash1 == hash2

    def test_compute_hash_different_for_different_input(self):
        """Test that different input produces different hash."""
        bytes1 = b"data version 1"
        bytes2 = b"data version 2"

        hash1 = StateService.compute_hash(bytes1)
        hash2 = StateService.compute_hash(bytes2)

        assert hash1 != hash2


class TestSaveState:
    """Tests for save_state method."""

    @pytest.mark.asyncio
    async def test_save_state_stores_state_and_metadata(
        self, state_service, mock_redis_client
    ):
        """Test that save_state stores state and metadata."""
        session_id = "test-session-123"
        raw_bytes = b"\x02test state data"  # Version 2 prefix
        state_b64 = base64.b64encode(raw_bytes).decode("utf-8")

        # Setup mock pipeline
        mock_pipe = AsyncMock()
        mock_pipe.setex = MagicMock()
        mock_pipe.execute = AsyncMock(return_value=[True, True, True])
        mock_redis_client.pipeline.return_value = mock_pipe

        result = await state_service.save_state(session_id, state_b64)

        # save_state now returns Tuple[bool, Optional[str]]
        success, state_hash = result
        assert success is True
        assert state_hash is not None
        # Verify pipeline was used with 2 setex calls (state, meta)
        assert mock_pipe.setex.call_count == 2

    @pytest.mark.asyncio
    async def test_save_state_empty_returns_true(self, state_service):
        """Test that empty state returns (True, None) without saving."""
        result = await state_service.save_state("session", "")

        # save_state now returns Tuple[bool, Optional[str]]
        success, state_hash = result
        assert success is True
        assert state_hash is None
