"""nsjail configuration and sandbox info dataclass.

SandboxInfo is the handle for a running sandbox. NsjailConfig builds
the CLI arguments for invoking nsjail.
"""

import os
import threading
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import structlog

from ...config import settings
from ...config.languages import get_user_id_for_language

logger = structlog.get_logger(__name__)

# Reserved host-uid range for per-session sandbox identities. Every sandbox
# execution gets a genuinely distinct kernel uid (not just a distinct
# in-namespace/"inside" uid mapped to the same shared host uid) so that
# credential checks used by ptrace()/mm_access() (which compare kuids, not
# in-namespace ids) can't treat two different tenants' processes as the
# same principal. Nothing else on the sandbox host may use this range.
SESSION_UID_RANGE_START = 200000
SESSION_UID_RANGE_END = 216383  # 16384 slots — far beyond realistic concurrency


class SessionUidAllocator:
    """Hands out distinct host uids for concurrently-running sandboxes.

    A fixed per-language uid (the old behavior) means every tenant's
    sandbox process resolves to the same kuid, so kernel credential checks
    (ptrace, /proc access) can't tell them apart. This allocator guarantees
    no two sandboxes alive at the same time share a uid, regardless of
    allocation order — it tracks the active set explicitly rather than
    relying on a hash or a simple non-wrapping counter.
    """

    def __init__(
        self, start: int = SESSION_UID_RANGE_START, end: int = SESSION_UID_RANGE_END
    ):
        self._start = start
        self._end = end
        self._next = start
        self._in_use: Set[int] = set()
        self._lock = threading.Lock()

    def allocate(self) -> int:
        with self._lock:
            span = self._end - self._start + 1
            for _ in range(span):
                candidate = self._next
                self._next = self._start if self._next >= self._end else self._next + 1
                if candidate not in self._in_use:
                    self._in_use.add(candidate)
                    return candidate
            raise RuntimeError(
                "Session uid pool exhausted — too many concurrently-running "
                "sandboxes for the configured range"
            )

    def release(self, uid: int) -> None:
        with self._lock:
            self._in_use.discard(uid)


@dataclass
class SandboxInfo:
    """Represents an nsjail sandbox instance.

    This is the handle used throughout the codebase to reference a
    running execution environment.
    """

    sandbox_id: str
    sandbox_dir: Path
    data_dir: Path  # Host dir bind-mounted as /mnt/data
    language: str
    session_id: str
    created_at: datetime
    repl_mode: bool = False
    labels: Dict[str, str] = field(default_factory=dict)
    # Distinct host uid for this sandbox's process, from SessionUidAllocator.
    # None only for legacy/transitional callers that haven't been updated —
    # NsjailConfig.build_args requires a real value.
    outside_uid: Optional[int] = None
    # Snapshot of (mtime_ns, size) for each mounted file basename, captured
    # right after _mount_files_to_sandbox writes the file but BEFORE user code
    # runs. Used by _detect_generated_files to distinguish "user edited a
    # mounted file in place" from "mounted file is unchanged" so iterative
    # edits to scripts get persisted as new file_ids in the current session.
    mounted_file_stats: Dict[
        str, Tuple[int, int, Optional[str], Optional[str], Optional[str]]
    ] = field(default_factory=dict)

    @property
    def id(self) -> str:
        """Compatibility property matching Container.id."""
        return self.sandbox_id


class NsjailConfig:
    """Builds nsjail CLI arguments from settings.

    Translates the application's security and resource settings into
    the corresponding nsjail command-line flags.
    """

    # Per-language read-only bind mounts for runtime paths
    _LANGUAGE_BIND_MOUNTS: Dict[str, List[str]] = {
        "py": [
            "/usr/local/lib/python3",
            "/usr/local/bin/python3",
            "/usr/local/bin/python",
        ],
        "js": [
            "/usr/local/bin/node",
            "/usr/local/lib/node_modules",
        ],
        "ts": [
            "/usr/local/bin/node",
            "/usr/local/bin/tsc",
            "/usr/local/lib/node_modules",
        ],
        "go": [
            "/usr/local/go",
        ],
        "java": [
            "/opt/java",
            "/usr/lib/jvm",
        ],
        "c": [],
        "cpp": [],
        "php": [
            "/usr/local/etc/php",
            "/usr/local/bin/php",
            "/usr/local/lib/php",
        ],
        "rs": [
            "/usr/local/cargo",
            "/usr/local/rustup",
        ],
        "r": [
            "/usr/local/lib/R",
            "/usr/lib/R",
        ],
        "f90": [],
        "d": [
            "/usr/lib/ldc",
            "/usr/bin/ldc2",
            "/usr/bin/ldmd2",
        ],
        "bash": [],
    }

    def __init__(self):
        pass

    def build_args(
        self,
        sandbox_dir: str,
        command: List[str],
        language: str,
        outside_uid: int,
        timeout: int = None,
        network: bool = False,
        repl_mode: bool = False,
        env: Optional[Dict[str, str]] = None,
    ) -> List[str]:
        """Build nsjail CLI arguments.

        Args:
            sandbox_dir: Host directory to bind-mount as /mnt/data
            command: Command and arguments to execute inside the sandbox
            language: Programming language code
            outside_uid: Distinct host uid for this sandbox's process (from
                SessionUidAllocator). Required — must be unique among
                concurrently-running sandboxes so kernel credential checks
                (ptrace/mm_access) can't treat two tenants as the same
                principal. Never reuse the fixed per-language uid here.
            timeout: Execution timeout in seconds
            network: Whether to allow network access
            repl_mode: Whether this is a REPL session (affects timeout)
            env: Environment variables to set inside the sandbox

        Returns:
            List of nsjail CLI arguments (not including "nsjail" itself)
        """
        if timeout is None:
            timeout = settings.max_execution_time

        normalized_lang = language.lower().strip()
        user_id = get_user_id_for_language(normalized_lang)
        tmpfs_size_mb = settings.sandbox_tmpfs_size_mb

        args: List[str] = []

        # Execution mode
        args.extend(["--mode", "o"])

        # Suppress nsjail diagnostic output
        args.append("--really_quiet")

        # REPL mode: skip setsid() so stdin pipes stay connected.
        # By default nsjail calls setsid() which creates a new session
        # and detaches the child from the pipe's session, breaking stdin.
        if repl_mode:
            args.append("--skip_setsid")

        # Time limit (0 = no limit for REPL mode)
        if repl_mode:
            args.extend(["--time_limit", "0"])
        else:
            args.extend(["--time_limit", str(timeout)])

        # Per-process resource limits (rlimits)
        args.extend(
            ["--rlimit_as", "hard"]
        )  # Virtual address space (Go needs unlimited)
        args.extend(["--rlimit_fsize", "100"])  # Max file size: 100MB
        args.extend(["--rlimit_nofile", "256"])  # Max open files
        args.extend(
            ["--rlimit_nproc", "256"]
        )  # Max processes (needs headroom for REPL module imports)

        # Note: per-sandbox cgroup limits are not used because the
        # containerized environment prevents nsjail from writing to cgroup.procs.
        # Memory/CPU limits are enforced at the API container level via compose
        # deploy.resources. Per-process rlimits above provide additional
        # per-sandbox enforcement for file size, open files, and process count.

        # Namespace configuration:
        # - User namespace: kept enabled (nsjail default). Previously disabled
        #   via --disable_clone_newuser to dodge a gid_map write error, but
        #   that also meant every sandbox ran as the SAME literal host uid —
        #   confirmed exploitable for cross-tenant /proc access (kernel
        #   credential checks compare kuids, and identical-uid sandboxes are
        #   indistinguishable to them). See --user/--group below: the
        #   inside:outside mapping now gives every sandbox a genuinely
        #   distinct outside (host) uid. If the gid_map write error
        #   resurfaces in a given deployment, it needs CAP_SETUID/CAP_SETGID
        #   granted to the task, not another --disable_clone_newuser.
        # - Network namespace enabled by default (disables network access).
        if not network:
            # Network isolation: new net namespace with no interfaces
            args.append("--iface_no_lo")
        else:
            # Allow network: skip creating a new network namespace
            args.append("--disable_clone_newnet")

        # Mount namespace: kept enabled (nsjail default) so nsjail can mount
        # its OWN /proc, scoped to the PID namespace it also creates — this
        # is the actual fix for the confirmed cross-tenant /proc leak.
        # Previously disabled via --disable_clone_newns because pivot_root
        # fails in this nested-container environment; --no_pivotroot (below)
        # is nsjail's documented workaround for exactly that (MS_MOVE+chroot
        # instead of pivot_root), so the mount namespace no longer needs to
        # be sacrificed to fix pivot_root.
        # Separately, the executor's outer `unshare --mount` + `mount --bind`
        # wrapper still runs first to map sandbox_dir to /mnt/data — nsjail's
        # own newns starts as a copy of that mount table, so both layers
        # compose correctly.
        args.append("--no_pivotroot")

        # Hostname
        args.extend(["--hostname", "sandbox"])

        # Security: do NOT use --keep_caps (that flag KEEPS caps).
        # By default nsjail drops all capabilities, which is what we want.
        #
        # /proc: previously --disable_proc entirely for most languages, with
        # java/rs/bash exempted (they need a working /proc — Java/Rust for
        # /proc/self/exe, bash for tools like LibreOffice). That exemption
        # gave those sandboxes the container's whole, unscoped, task-wide
        # /proc — a confirmed cross-tenant read (root/cwd/fd/environ/maps)
        # and write (/proc/<peer>/mem) vector, "trusted-tenant" comment
        # notwithstanding. Fix: mount a REAL procfs, but scoped to nsjail's
        # own new PID namespace (only possible now that clone_newns is back
        # on) — every language gets a working /proc that shows only this
        # sandbox's own process tree. hidepid=2,subset=pid is defense in
        # depth on top of the namespace scoping, not a substitute for it —
        # hidepid alone does nothing when sandboxes share a uid, which is why
        # --user/--group below also stopped doing that.
        args.extend(["--mount", "none:/proc:proc:hidepid=2,subset=pid"])

        # Filesystem: with clone_newns back on, nsjail builds its OWN mount
        # tree from scratch instead of just inheriting the parent's — every
        # path the sandboxed process needs must be explicitly bound here now.
        # Confirmed by direct testing: without these, even chdir('/mnt/data')
        # fails, then execve of the target binary fails (ENOENT — indistinguishable
        # from a missing binary, but actually a missing dynamic linker/lib).
        #
        # /bin, /lib, /sbin are usr-merge symlinks into /usr on this base image
        # (bin -> usr/bin, etc.) — binding the symlink path itself doesn't work
        # (nsjail creates a real directory at the mountpoint, which then shadows
        # rather than follows the symlink target inside the jail). Bind the
        # RESOLVED real path as the source instead: -R /usr/bin:/bin.
        # /lib64 is the same story and easy to miss — leaving it out doesn't fail
        # loudly, it just makes execve() of any dynamically-linked binary fail
        # with ENOENT (the missing piece is /lib64/ld-linux-x86-64.so.2, the
        # binary's own interpreter, not the binary itself).
        args.extend(["-R", "/usr"])
        args.extend(["-R", "/usr/bin:/bin"])
        args.extend(["-R", "/usr/lib:/lib"])
        args.extend(["-R", "/usr/lib64:/lib64"])
        args.extend(["-R", "/usr/sbin:/sbin"])
        # /opt holds repl_server.py/ptc_server.py/ptc_bash_server.py — baked
        # into the image, needed by REPL and PTC modes.
        args.extend(["-R", "/opt"])
        # sandbox_dir is bind-mounted to /mnt/data by the *outer* unshare
        # wrapper (executor/programmatic/pool/runner), but nsjail's own new
        # mount namespace doesn't inherit that automatically anymore — needs
        # its own explicit (read-write) bind of the same path.
        args.extend(["-B", "/mnt/data"])
        # SSL certs, alternatives — best-effort: these paths aren't
        # guaranteed to exist on every base image, and nsjail's CLI bind
        # flags are mandatory (unlike the proto file's mandatory:false), so
        # only add them if actually present to avoid a hard failure. NOT
        # under /usr, so no ordering conflict with the /usr bind above.
        for optional_path in ("/etc/ssl", "/etc/alternatives"):
            if os.path.exists(optional_path):
                args.extend(["-R", optional_path])
        # Per-language runtime paths (_LANGUAGE_BIND_MOUNTS) are NOT bound
        # separately here — every single one of them (python/node/go/rust/
        # php/etc., plus the timezone data originally considered above) is
        # already a subpath of /usr or /opt, both already bound whole above.
        # Binding a subpath again on top of an already-mounted read-only
        # parent fails with "Permission denied" — createMountTarget() can't
        # create a new mountpoint inside a mount that's already active and
        # read-only — confirmed by direct reproduction against the actual
        # repl_server.py launch path. The whole-tree /usr + /opt binds above
        # already cover every one of these paths.
        # Writable /tmp inside the jail — nsjail's own mount namespace needs
        # its own, separate from the outer wrapper's /tmp tmpfs (BUG-007).
        # Sized to match settings.sandbox_tmpfs_size_mb rather than nsjail's
        # unsized --tmpfsmount default.
        args.extend(["-m", f"none:/tmp:tmpfs:size={tmpfs_size_mb * 1024 * 1024}"])

        # Seccomp policy: block dangerous syscalls
        # - ptrace: prevents process inspection/debugging (BUG-006a). Note
        #   this alone does NOT cover /proc/<pid>/mem access (mm_access()
        #   uses PTRACE_MODE_ATTACH_FSCREDS internally but the syscalls used
        #   to reach it — open()/pread()/pwrite() — aren't ptrace(2) itself,
        #   so this rule doesn't block that path; the namespace-scoped /proc
        #   mount above is what actually closes it, by making peer pids not
        #   exist in this sandbox's view at all.
        # - bind: was originally blocked to prevent server sockets even with
        #   network access (BUG-006c), but bash sandboxes need it for tools
        #   like LibreOffice which use AF_UNIX sockets internally for IPC.
        #   Allow bind there; keep blocking for other languages.
        # Using ERRNO(1) so the process gets EPERM rather than SIGSYS
        if normalized_lang == "bash":
            seccomp_policy = (
                "POLICY policy { ERRNO(1) { ptrace } } USE policy DEFAULT ALLOW"
            )
        else:
            seccomp_policy = (
                "POLICY policy { ERRNO(1) { ptrace, bind } } USE policy DEFAULT ALLOW"
            )
        args.extend(["--seccomp_string", seccomp_policy])

        # Working directory: /mnt/data (bind-mounted by the executor wrapper)
        args.extend(["--cwd", "/mnt/data"])

        # User/group: inside:outside:count mapping (requires clone_newuser,
        # which is back on above). `user_id` is only the in-namespace
        # identity now — every sandbox still sees itself as e.g. uid 1001,
        # but each is mapped to a DISTINCT real host uid (outside_uid).
        # Previously this was a bare uid with no namespace, so every
        # sandbox — every tenant — really was the same host uid, and kernel
        # credential checks (which compare kuids, not in-namespace ids)
        # couldn't tell them apart. A shared outside_id here would silently
        # reintroduce that; never default it to `user_id` or to a constant.
        args.extend(["--user", f"{user_id}:{outside_uid}:1"])
        args.extend(["--group", f"{user_id}:{outside_uid}:1"])

        # Environment variables
        if env:
            for key, value in env.items():
                args.extend(["--env", f"{key}={value}"])

        # Separator between nsjail args and the command
        args.append("--")

        # Append the actual command
        args.extend(command)

        return args
