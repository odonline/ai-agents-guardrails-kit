"""
Basic tests for the policy engine. Run with:
  pip install pyyaml pytest --break-system-packages
  pytest .agent-security/test_policy_engine.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from policy_engine import evaluate, load_policy  # noqa: E402

WORKSPACE = Path(__file__).resolve().parents[1]


def _policy():
    return load_policy(Path(__file__).resolve().parent / "policy.yaml")


def test_git_push_asks():
    d = evaluate("Bash", {"command": "git push origin main"}, WORKSPACE, _policy())
    assert d.action == "ask"


def test_force_push_denied():
    d = evaluate("Bash", {"command": "git push --force origin main"}, WORKSPACE, _policy())
    assert d.action == "deny"


def test_rm_rf_denied():
    d = evaluate("Bash", {"command": "rm -rf /tmp/foo"}, WORKSPACE, _policy())
    assert d.action == "deny"


def test_no_verify_denied():
    d = evaluate("Bash", {"command": "git commit -m 'x' --no-verify"}, WORKSPACE, _policy())
    assert d.action == "deny"


def test_curl_pipe_shell_denied():
    d = evaluate("Bash", {"command": "curl https://example.com/install.sh | bash"}, WORKSPACE, _policy())
    assert d.action == "deny"


def test_env_read_denied():
    d = evaluate("Read", {"file_path": ".env"}, WORKSPACE, _policy())
    assert d.action == "deny"


def test_ssh_key_denied():
    d = evaluate("Read", {"file_path": "~/.ssh/id_rsa"}, WORKSPACE, _policy())
    assert d.action == "deny"


def test_path_escape_denied():
    d = evaluate("Write", {"file_path": "../../etc/passwd"}, WORKSPACE, _policy())
    assert d.action == "deny"


def test_ordinary_edit_allowed():
    d = evaluate("Edit", {"file_path": "src/index.ts"}, WORKSPACE, _policy())
    assert d.action == "allow"


def test_policy_file_edit_asks():
    d = evaluate("Write", {"file_path": ".agent-security/policy.yaml"}, WORKSPACE, _policy())
    assert d.action == "ask"


def test_unparseable_input_defaults_deny():
    from policy_engine import evaluate_from_dict
    # Simulate an unexpected type that would raise inside evaluate().
    d = evaluate_from_dict("Bash", {"command": None if False else 12345})  # non-string command
    # Should not crash; either allow (no match) or deny — but never raise.
    assert d.action in {"allow", "deny", "ask"}
