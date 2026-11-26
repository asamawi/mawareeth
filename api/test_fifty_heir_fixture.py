"""The 50-Heir browser fixture (story 9.12): built through the real API and checked for consistency.

`web/e2e/fixtures/fifty-heirs.json` holds the Case and Share preview the server answers for a family of
50 Heirs: wide and deep lineage, long Arabic and English names, a blocked grandchild, a person who died
before and two later estates. Every name is made up. The browser suites serve it from stubs, so it
must be what the server really says. Regenerate it with
`WRITE_FIFTY_HEIR_FIXTURE=1 uv run python manage.py test api.test_fifty_heir_fixture --noinput`.
"""
import json
import os
from pathlib import Path
from unittest import skipUnless

from django.contrib.sessions.models import Session
from django.db import connection
from django.test import TransactionTestCase, override_settings

from api.capacity import Harness, SetupError

FIXTURE = Path(__file__).resolve().parent.parent / "web" / "e2e" / "fixtures" / "fifty-heirs.json"
NAMES = [
    "عبد الرحمن بن محمد بن عبد العزيز آل سعود المطيري الحربي",
    "Alexandria Montgomery-Featherstonehaugh of Greater Westminster",
    "فاطمة الزهراء بنت عبد الله بن أحمد الكبيسي",
    "Mohammed Abdulrahman Al-Fahad bin Sultan",
    "نور",
    "Li",
]


def build(harness):
    client = harness.client()
    case = harness.write(client, None, "POST", "", {})
    case = harness.write(client, case, "PUT", "deceased/", dict(gender="male", estate="1250000"))

    def name(index):
        return NAMES[index % len(NAMES)]

    def add(case, relationship, index, **extra):
        return harness.write(client, case, "POST", "heirs/", dict(relationship=relationship, name=name(index), **extra))

    def newest(case, layer=None):
        rows = case["heirs"] if layer is None else next(d for d in case["deaths"] if d["heir_id"] == layer)["heirs"]
        return rows[-1]["id"]

    # A wide first level: the wife and 40 children.
    items = [dict(relationship="wife", name=name(0))] + [
        dict(relationship="son" if i % 2 == 0 else "daughter", name=name(i)) for i in range(40)]
    case = harness.write(client, case, "POST", "heirs/bulk/", dict(heirs=items))
    sons = [r["id"] for r in case["heirs"] if r["relationship"] == "son"]
    # A line three deep, upward: the father, and his parent.
    case = add(case, "father", 1)
    father = newest(case)
    option = next(o for o in case["placement"][father] if o["link"] == "parent")
    case = add(case, option["relationship"], 2, anchor=father)
    # A wide second level: four grandchildren of the first son.
    for index in range(4):
        option = next(o for o in case["placement"][sons[0]] if o["link"] == "child")
        case = add(case, option["relationship"], index + 3, anchor=sons[0])
    # A person who died before the deceased.
    case = harness.write(client, case, "PUT", "heirs/" + sons[5] + "/",
                         dict(relationship="son", name=name(5), status="died_before_or_with"))
    # Fill the first estate to 50 Heirs.
    fill = 50 - len(case["heirs"])
    if fill > 0:
        case = harness.write(client, case, "POST", "heirs/bulk/", dict(heirs=[
            dict(relationship="daughter" if i % 2 else "son", name=name(i + 2)) for i in range(fill)]))
    # Two later estates: the third son's, then his son's.
    first = sons[10]
    case = harness.write(client, case, "POST", "deaths/", dict(heir_id=first, empty=True))
    case = add(case, "son", 2, layer=first)
    case = add(case, "wife", 0, layer=first)
    second = next(r["id"] for r in case["deaths"][0]["heirs"] if r["relationship"] == "son")
    case = harness.write(client, case, "POST", "deaths/", dict(heir_id=second, first=first, empty=True))
    case = add(case, "son", 4, layer=second)
    response, _, _ = harness.request(client, "GET", "/api/v1/case/preview/?case_id=" + case["id"])
    if response.status_code != 200:
        raise SetupError()
    return case, response.json()


def shape(case, preview):
    """What the browser suites rely on, without ids or names."""
    statuses = sorted(p["status"] for p in case["persons"])
    return dict(
        heirs=len(case["heirs"]), deaths=[len(d["heirs"]) for d in case["deaths"]], edges=len(case["edges"]),
        edge_kinds=sorted(e["kind"] for e in case["edges"]), statuses=statuses, died_before=len(case.get("died_before", [])),
        relationships=sorted(h["relationship"] for h in case["heirs"]), preview=preview["status"],
        blocked=sum(1 for e in preview["presented"]["evidence"] for h in e["heirs"] if h["rule"]["code"] == "blocked"))


@skipUnless(connection.vendor == "postgresql", "requires PostgreSQL")
class FiftyHeirFixtureTests(TransactionTestCase):
    @skipUnless(os.environ.get("WRITE_FIFTY_HEIR_FIXTURE") == "1", "set WRITE_FIFTY_HEIR_FIXTURE=1 to rewrite the fixture")
    @override_settings(SNAPSHOT_WRITE_VERSION=2)
    def test_write_fixture(self):
        harness = Harness()
        try:
            case, preview = build(harness)
        finally:
            Session.objects.filter(session_key__in=harness.keys).delete()
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(json.dumps(dict(case=case, preview=preview), ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n",
                           encoding="utf-8")

    def test_fixture_is_the_full_family(self):
        data = json.loads(FIXTURE.read_text(encoding="utf-8"))
        case, preview = data["case"], data["preview"]
        self.assertEqual(len(case["heirs"]), 50)
        self.assertEqual(len(case["deaths"]), 2)
        self.assertTrue(case["edges"])
        self.assertTrue(any(p["status"] == "died_before_or_with" for p in case["persons"]))
        self.assertIn(preview["status"], ("available", "choose_school"))
        self.assertEqual(preview["revision"], case["revision"])
        self.assertEqual(
            [h["id"] for h in preview["basis"]["heirs"]], [h["id"] for h in case["heirs"]])
        self.assertTrue(any(len(h["name"] or "") > 40 for h in case["heirs"]))

    @override_settings(SNAPSHOT_WRITE_VERSION=2)
    def test_fixture_matches_a_rebuild_through_the_real_api(self):
        harness = Harness()
        try:
            case, preview = build(harness)
        finally:
            Session.objects.filter(session_key__in=harness.keys).delete()
        data = json.loads(FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(shape(case, preview), shape(data["case"], data["preview"]))
