"""The repository security audit detects what it is meant to detect, and the repository passes it."""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("security_audit", ROOT / "scripts" / "security_audit.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def test_patterns_detect_secrets_and_local_details():
    # Built at runtime so this file does not itself contain the forbidden strings.
    samples = {
        "GitHub token": "token=gh" + "p_" + "A" * 36,
        "local file path": "C" + ":\\Users\\someone\\file.txt",
        "private network URL": "http://192." + "168.1.20:8080/",
    }
    for name, text in samples.items():
        assert any(f": {name}:" in h for h in audit.scan_text("sample", text)), name


def test_library_tables_and_regular_expressions_are_not_flagged():
    assert audit.scan_text("lib.js", "06.07.08.09.0a 10.11.12.13") == []
    assert audit.scan_text("regex.py", r"uses:\s*actions/") == []


def test_forbidden_file_types():
    for name in [".env", "config/.env.local", "x/backup.duckdb", "report.pbix", "id.pem"]:
        assert audit.FORBIDDEN_FILES.search(name), name
    for name in ["web/public/data/latest.json", "README.md", "environment.md"]:
        assert not audit.FORBIDDEN_FILES.search(name), name


def test_repository_history_passes_the_audit():
    findings, n = audit.audit_history()
    assert n > 0
    assert findings == []
