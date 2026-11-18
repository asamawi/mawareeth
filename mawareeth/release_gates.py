"""Read-only gates shared by image checks and operational probes."""
import contextlib
import io
import json
import unittest
from pathlib import Path


def catalogs():
    import i18n
    i18n.registry()
    codes = i18n.published_codes()
    assert codes
    baseline = None
    for code in codes:
        catalog = i18n.catalog(code)
        assert catalog.locale == code and catalog.terms
        signature = {key: term.placeholders for key, term in catalog.terms.items()}
        assert all(term.text.strip() for term in catalog.terms.values())
        if baseline is None:
            baseline = signature
        assert signature == baseline


def suite(*names):
    tests = unittest.defaultTestLoader.loadTestsFromNames(names)
    result = unittest.TestResult()
    tests.run(result)
    assert result.testsRun and result.wasSuccessful()


def snapshots():
    from api.snapshots import READ_VERSIONS, WRITE_VERSION, decode, encode_v2
    from api.anonymous_case import export_snapshot
    root = Path(__file__).resolve().parents[1] / "api/fixtures/snapshots"
    matrix = json.loads((root / "matrix.json").read_text())
    assert (matrix[-1]["reads"], matrix[-1]["writes"]) == (list(READ_VERSIONS), WRITE_VERSION)
    assert 1 in READ_VERSIONS
    for index, image in enumerate(matrix):
        for neighbour in matrix[max(0, index-1):index+2]:
            assert image["writes"] in neighbour["reads"]
    for path in root.glob("v1-*.json"):
        original = json.loads(path.read_text(encoding="utf-8"))
        encoded = encode_v2(original)
        assert encoded == json.loads(path.with_name("v2-" + path.name[3:]).read_text(encoding="utf-8"))
        assert encode_v2(export_snapshot(decode(2, encoded, "id", "time"))) == encoded
        for version in READ_VERSIONS:
            decode(version, json.loads(path.with_name(f"v{version}-" + path.name[3:]).read_text(encoding="utf-8")), "id", "time")


def glyphs():
    from i18n.glyphs import main
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        result = main()
    if result == 2:
        import shutil
        assert shutil.which("fc-list") is None
        return "glyphs skipped: fc-list missing"
    assert result == 0


def gates():
    return {
        "purity": lambda: suite("engine.tests.test_purity"),
        "engine": lambda: suite("engine.tests.test_core", "engine.tests.test_layered", "engine.tests.test_contracts", "engine.tests.test_queries"),
        "contracts": lambda: suite("engine.tests.test_contracts"),
        "snapshots": snapshots,
        "catalogs": catalogs,
        "glyphs": glyphs,
        "presentation": lambda: suite("presentation.tests.test_display_changes"),
    }
