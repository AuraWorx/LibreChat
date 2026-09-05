"""Unit tests for NsjailConfig builder and SandboxInfo dataclass."""

import pytest
from pathlib import Path
from datetime import datetime

from src.services.sandbox.nsjail import (
    NsjailConfig,
    SandboxInfo,
    SessionUidAllocator,
    SESSION_UID_RANGE_START,
    SESSION_UID_RANGE_END,
)

# Fixed test uid for build_args() calls that don't care about the specific
# value, just that a distinct one was supplied.
TEST_OUTSIDE_UID = 200123


class TestNsjailConfigBuildArgs:
    """Test NsjailConfig.build_args() generates correct nsjail CLI arguments."""

    def test_basic_python_args(self):
        """Test basic argument generation for Python."""
        config = NsjailConfig()
        args = config.build_args(
            sandbox_dir="/tmp/sandbox/data",
            command=["python3", "code.py"],
            language="py",
            outside_uid=TEST_OUTSIDE_UID,
            timeout=30,
        )
        assert "--mode" in args
        assert "o" in args
        assert "--cwd" in args
        assert "/mnt/data" in args
        assert "python3" in args
        assert "code.py" in args

    def test_network_disabled_by_default(self):
        """Test that network namespace is created by default (no network access)."""
        config = NsjailConfig()
        args = config.build_args(
            sandbox_dir="/tmp/sandbox/data",
            command=["python3", "code.py"],
            language="py",
            outside_uid=TEST_OUTSIDE_UID,
        )
        # Network isolation is on by default (iface_no_lo disables loopback)
        assert "--iface_no_lo" in args
        # Should NOT have --disable_clone_newnet
        assert "--disable_clone_newnet" not in args

    def test_network_enabled(self):
        """Test network access when enabled (disable network namespace)."""
        config = NsjailConfig()
        args = config.build_args(
            sandbox_dir="/tmp/sandbox/data",
            command=["python3", "code.py"],
            language="py",
            outside_uid=TEST_OUTSIDE_UID,
            network=True,
        )
        # When network=True, network namespace is disabled
        assert "--disable_clone_newnet" in args
        assert "--iface_no_lo" not in args

    def test_timeout_set(self):
        """Test timeout is passed correctly."""
        config = NsjailConfig()
        args = config.build_args(
            sandbox_dir="/tmp/sandbox/data",
            command=["python3", "code.py"],
            language="py",
            outside_uid=TEST_OUTSIDE_UID,
            timeout=60,
        )
        assert "--time_limit" in args
        idx = args.index("--time_limit")
        assert args[idx + 1] == "60"

    def test_repl_mode_timeout_zero(self):
        """Test REPL mode sets timeout to 0 and enables skip_setsid."""
        config = NsjailConfig()
        args = config.build_args(
            sandbox_dir="/tmp/sandbox/data",
            command=["python3", "/opt/repl_server.py"],
            language="py",
            outside_uid=TEST_OUTSIDE_UID,
            repl_mode=True,
        )
        assert "--time_limit" in args
        idx = args.index("--time_limit")
        assert args[idx + 1] == "0"
        assert "--skip_setsid" in args

    def test_different_languages(self):
        """Test args generation for different languages."""
        config = NsjailConfig()
        for lang in ["py", "js", "go", "java", "c", "cpp", "rs"]:
            args = config.build_args(
                sandbox_dir="/tmp/sandbox/data",
                command=["echo", "test"],
                language=lang,
                outside_uid=TEST_OUTSIDE_UID,
            )
            assert len(args) > 0
            assert "--mode" in args
            assert "echo" in args
            assert "test" in args

    def test_capabilities_dropped_by_default(self):
        """Test capabilities are dropped (no --keep_caps flag)."""
        config = NsjailConfig()
        args = config.build_args(
            sandbox_dir="/tmp/sandbox/data",
            command=["echo", "test"],
            language="py",
            outside_uid=TEST_OUTSIDE_UID,
        )
        # nsjail drops all caps by default. --keep_caps would KEEP them.
        assert "--keep_caps" not in args

    def test_user_namespace_enabled(self):
        """User namespace must stay enabled (nsjail default) — it's required
        for the inside:outside uid mapping that gives every sandbox a
        distinct kernel uid. Disabling it (the old behavior) meant every
        sandbox ran as the same literal host uid, which is what made the
        confirmed cross-tenant /proc read/write exploit possible."""
        config = NsjailConfig()
        args = config.build_args(
            sandbox_dir="/tmp/sandbox/data",
            command=["echo", "test"],
            language="py",
            outside_uid=TEST_OUTSIDE_UID,
        )
        assert "--disable_clone_newuser" not in args

    def test_mount_namespace_enabled_with_no_pivotroot(self):
        """Mount namespace must stay enabled (nsjail default) so nsjail can
        mount its own PID-namespace-scoped /proc. --no_pivotroot replaces
        the old --disable_clone_newns workaround for pivot_root failing in
        nested containers, without sacrificing namespace isolation."""
        config = NsjailConfig()
        args = config.build_args(
            sandbox_dir="/tmp/sandbox/data",
            command=["echo", "test"],
            language="py",
            outside_uid=TEST_OUTSIDE_UID,
        )
        assert "--disable_clone_newns" not in args
        assert "--no_pivotroot" in args

    def test_hostname_set_to_sandbox(self):
        """Test hostname is set to 'sandbox'."""
        config = NsjailConfig()
        args = config.build_args(
            sandbox_dir="/tmp/sandbox/data",
            command=["echo", "test"],
            language="py",
            outside_uid=TEST_OUTSIDE_UID,
        )
        assert "--hostname" in args
        idx = args.index("--hostname")
        assert args[idx + 1] == "sandbox"

    def test_proc_mounted_scoped_for_every_language(self):
        """Every language must get a real, namespace-scoped /proc mount —
        not --disable_proc, and not the old java/rs/bash-only exemption
        that handed those three languages the raw, unscoped, task-wide
        /proc. hidepid/subset alone don't matter without namespace scoping
        (same-uid peers bypass hidepid), but they're present as defense in
        depth."""
        config = NsjailConfig()
        for lang in ["py", "js", "go", "java", "c", "cpp", "rs", "bash"]:
            args = config.build_args(
                sandbox_dir="/tmp/sandbox/data",
                command=["echo", "test"],
                language=lang,
                outside_uid=TEST_OUTSIDE_UID,
            )
            assert "--disable_proc" not in args
            assert "--mount" in args
            idx = args.index("--mount")
            assert args[idx + 1] == "none:/proc:proc:hidepid=2,subset=pid"

    def test_command_separator(self):
        """Test command separator '--' is present before the command."""
        config = NsjailConfig()
        args = config.build_args(
            sandbox_dir="/tmp/sandbox/data",
            command=["python3", "code.py"],
            language="py",
            outside_uid=TEST_OUTSIDE_UID,
        )
        assert "--" in args
        separator_idx = args.index("--")
        assert args[separator_idx + 1] == "python3"
        assert args[separator_idx + 2] == "code.py"

    def test_env_vars_passed(self):
        """Test environment variables are passed correctly."""
        config = NsjailConfig()
        args = config.build_args(
            sandbox_dir="/tmp/sandbox/data",
            command=["echo", "test"],
            language="py",
            outside_uid=TEST_OUTSIDE_UID,
            env={"MY_VAR": "my_value", "ANOTHER": "val2"},
        )
        assert "--env" in args
        env_indices = [i for i, a in enumerate(args) if a == "--env"]
        env_values = [args[i + 1] for i in env_indices]
        assert "MY_VAR=my_value" in env_values
        assert "ANOTHER=val2" in env_values

    def test_user_group_use_distinct_outside_uid(self):
        """--user/--group must use the inside:outside:count mapping with the
        caller-supplied outside_uid — never a bare/shared uid. A bare uid
        (or an outside id equal to another sandbox's) is exactly the bug
        that let every tenant's sandbox resolve to the same kernel uid."""
        config = NsjailConfig()
        args = config.build_args(
            sandbox_dir="/tmp/sandbox/data",
            command=["echo", "test"],
            language="py",
            outside_uid=TEST_OUTSIDE_UID,
        )
        assert "--user" in args
        assert "--group" in args
        user_idx = args.index("--user")
        group_idx = args.index("--group")
        assert args[user_idx + 1].endswith(f":{TEST_OUTSIDE_UID}:1")
        assert args[group_idx + 1].endswith(f":{TEST_OUTSIDE_UID}:1")

    def test_different_outside_uids_produce_different_args(self):
        """Sanity check that outside_uid actually flows through — two calls
        with different values must not produce identical --user/--group."""
        config = NsjailConfig()
        args_a = config.build_args(
            sandbox_dir="/tmp/sandbox/data",
            command=["echo", "test"],
            language="py",
            outside_uid=200100,
        )
        args_b = config.build_args(
            sandbox_dir="/tmp/sandbox/data",
            command=["echo", "test"],
            language="py",
            outside_uid=200200,
        )
        user_a = args_a[args_a.index("--user") + 1]
        user_b = args_b[args_b.index("--user") + 1]
        assert user_a != user_b

    def test_cwd_is_mnt_data(self):
        """Test working directory is /mnt/data."""
        config = NsjailConfig()
        args = config.build_args(
            sandbox_dir="/tmp/sandbox/data",
            command=["echo", "test"],
            language="py",
            outside_uid=TEST_OUTSIDE_UID,
        )
        idx = args.index("--cwd")
        assert args[idx + 1] == "/mnt/data"


class TestSessionUidAllocator:
    """Test SessionUidAllocator uniqueness/exhaustion/release behavior."""

    def test_allocations_are_unique_while_active(self):
        allocator = SessionUidAllocator()
        allocated = {allocator.allocate() for _ in range(500)}
        assert len(allocated) == 500

    def test_released_uid_can_be_reallocated(self):
        allocator = SessionUidAllocator(start=200000, end=200002)  # 3 slots
        a = allocator.allocate()
        b = allocator.allocate()
        c = allocator.allocate()
        assert {a, b, c} == {200000, 200001, 200002}
        allocator.release(b)
        d = allocator.allocate()
        assert d == b

    def test_pool_exhaustion_raises(self):
        allocator = SessionUidAllocator(start=300000, end=300001)  # 2 slots
        allocator.allocate()
        allocator.allocate()
        with pytest.raises(RuntimeError):
            allocator.allocate()

    def test_default_range_matches_module_constants(self):
        allocator = SessionUidAllocator()
        uid = allocator.allocate()
        assert SESSION_UID_RANGE_START <= uid <= SESSION_UID_RANGE_END

    def test_release_of_unknown_uid_is_a_no_op(self):
        allocator = SessionUidAllocator()
        allocator.release(999999)  # never allocated — must not raise


class TestSandboxInfo:
    """Test SandboxInfo dataclass."""

    def test_id_property(self):
        """Test id property returns sandbox_id."""
        info = SandboxInfo(
            sandbox_id="abc123",
            sandbox_dir=Path("/tmp/abc"),
            data_dir=Path("/tmp/abc/data"),
            language="py",
            session_id="sess1",
            created_at=datetime.utcnow(),
        )
        assert info.id == "abc123"

    def test_default_values(self):
        """Test default values are set correctly."""
        info = SandboxInfo(
            sandbox_id="abc",
            sandbox_dir=Path("/tmp/abc"),
            data_dir=Path("/tmp/abc/data"),
            language="py",
            session_id="s1",
            created_at=datetime.utcnow(),
        )
        assert info.repl_mode is False
        assert info.labels == {}
        assert info.outside_uid is None

    def test_repl_mode_set(self):
        """Test repl_mode can be set."""
        info = SandboxInfo(
            sandbox_id="abc",
            sandbox_dir=Path("/tmp/abc"),
            data_dir=Path("/tmp/abc/data"),
            language="py",
            session_id="s1",
            created_at=datetime.utcnow(),
            repl_mode=True,
        )
        assert info.repl_mode is True

    def test_labels_set(self):
        """Test labels can be set."""
        labels = {"key1": "val1", "key2": "val2"}
        info = SandboxInfo(
            sandbox_id="abc",
            sandbox_dir=Path("/tmp/abc"),
            data_dir=Path("/tmp/abc/data"),
            language="py",
            session_id="s1",
            created_at=datetime.utcnow(),
            labels=labels,
        )
        assert info.labels == labels

    def test_outside_uid_set(self):
        """Test outside_uid can be set."""
        info = SandboxInfo(
            sandbox_id="abc",
            sandbox_dir=Path("/tmp/abc"),
            data_dir=Path("/tmp/abc/data"),
            language="py",
            session_id="s1",
            created_at=datetime.utcnow(),
            outside_uid=200123,
        )
        assert info.outside_uid == 200123

    def test_fields_stored(self):
        """Test all fields are stored correctly."""
        now = datetime.utcnow()
        info = SandboxInfo(
            sandbox_id="sandbox-xyz",
            sandbox_dir=Path("/var/sandboxes/xyz"),
            data_dir=Path("/var/sandboxes/xyz/data"),
            language="go",
            session_id="session-456",
            created_at=now,
        )
        assert info.sandbox_id == "sandbox-xyz"
        assert info.sandbox_dir == Path("/var/sandboxes/xyz")
        assert info.data_dir == Path("/var/sandboxes/xyz/data")
        assert info.language == "go"
        assert info.session_id == "session-456"
        assert info.created_at == now
