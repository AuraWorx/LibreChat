"""Focused tests for args support in execution requests."""

from src.models.execution import ExecuteCodeRequest
from src.models.exec import ExecRequest
from src.services.orchestrator import ExecutionOrchestrator


class TestExecuteCodeRequestArgs:
    """Tests for ExecuteCodeRequest args support."""

    def test_execute_code_request_has_args_field(self):
        request = ExecuteCodeRequest(
            code="print('hello')",
            language="py",
            args=["arg1", "arg2"],
        )
        assert request.args == ["arg1", "arg2"]

    def test_execute_code_request_args_defaults_none(self):
        request = ExecuteCodeRequest(
            code="print('hello')",
            language="py",
        )
        assert request.args is None


class TestNormalizeArgs:
    """Tests for args normalization in the orchestrator."""

    def test_normalize_args_none(self):
        orchestrator = ExecutionOrchestrator.__new__(ExecutionOrchestrator)
        result = orchestrator._normalize_args(None)
        assert result is None

    def test_normalize_args_string(self):
        orchestrator = ExecutionOrchestrator.__new__(ExecutionOrchestrator)
        result = orchestrator._normalize_args("single-arg")
        assert result == ["single-arg"]

    def test_normalize_args_empty_string(self):
        orchestrator = ExecutionOrchestrator.__new__(ExecutionOrchestrator)
        result = orchestrator._normalize_args("")
        assert result is None

    def test_normalize_args_list(self):
        orchestrator = ExecutionOrchestrator.__new__(ExecutionOrchestrator)
        result = orchestrator._normalize_args(["arg1", "arg2"])
        assert result == ["arg1", "arg2"]

    def test_normalize_args_list_with_none(self):
        orchestrator = ExecutionOrchestrator.__new__(ExecutionOrchestrator)
        result = orchestrator._normalize_args(["arg1", None, "arg2"])
        assert result == ["arg1", "arg2"]

    def test_normalize_args_empty_list(self):
        orchestrator = ExecutionOrchestrator.__new__(ExecutionOrchestrator)
        result = orchestrator._normalize_args([])
        assert result is None

    def test_normalize_args_integer(self):
        orchestrator = ExecutionOrchestrator.__new__(ExecutionOrchestrator)
        result = orchestrator._normalize_args(42)
        assert result == ["42"]

    def test_normalize_args_with_spaces(self):
        orchestrator = ExecutionOrchestrator.__new__(ExecutionOrchestrator)
        result = orchestrator._normalize_args(["arg with spaces", "another arg"])
        assert result == ["arg with spaces", "another arg"]


class TestExecRequestArgsField:
    """Tests for args support in ExecRequest."""

    def test_exec_request_accepts_args_list(self):
        request = ExecRequest(
            code="print('hello')",
            lang="py",
            args=["arg1", "arg2"],
        )
        assert request.args == ["arg1", "arg2"]

    def test_exec_request_accepts_args_string(self):
        request = ExecRequest(
            code="print('hello')",
            lang="py",
            args="single-arg",
        )
        assert request.args == "single-arg"

    def test_exec_request_args_defaults_none(self):
        request = ExecRequest(
            code="print('hello')",
            lang="py",
        )
        assert request.args is None
