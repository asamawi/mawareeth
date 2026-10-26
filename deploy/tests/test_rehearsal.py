"""Offline tests for deploy/rehearsal.py: fake /proc fixtures for every
capacity threshold edge, and the load generator against a local server."""

import http.server
import signal
import socket
import tempfile
import threading
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path

from deploy import rehearsal

HEADER = "\t".join(rehearsal.COLUMNS)
MEM_TOTAL = 8_000_000


def row(epoch, busy, total, available, swap_in=0, swap_out=0, oom=0):
    return [epoch, busy, total, MEM_TOTAL, available, swap_in, swap_out, oom]


def steady(cpu_percent, memory_percent, minutes=16, interval=15, **counters):
    """Samples at a constant CPU and memory load; counters end on the last row."""
    rows = []
    busy = total = 0
    count = minutes * 60 // interval + 1
    available = round(MEM_TOTAL * (1 - memory_percent / 100))
    for index in range(count):
        last = index == count - 1
        rows.append(
            row(
                1_000_000 + index * interval,
                busy,
                total,
                available,
                counters.get("swap_in", 0) if last else 0,
                counters.get("swap_out", 0) if last else 0,
                counters.get("oom", 0) if last else 0,
            )
        )
        total += 1000
        busy += round(10 * cpu_percent)
    return rows


class EvaluateTests(unittest.TestCase):
    def evaluate(self, rows):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "samples.tsv"
            lines = [HEADER] + ["\t".join(str(value) for value in r) for r in rows]
            path.write_text("\n".join(lines) + "\n", encoding="ascii")
            out = StringIO()
            with redirect_stdout(out), redirect_stderr(StringIO()):
                status = rehearsal.main(["evaluate", str(path)])
        fields = dict(line.split("=", 1) for line in out.getvalue().splitlines())
        return status, fields

    def test_quiet_host_passes(self):
        status, fields = self.evaluate(steady(30, 50))
        self.assertEqual(status, 0)
        self.assertEqual(fields["result"], "pass")
        self.assertEqual(fields["breaches"], "")
        self.assertEqual(fields["peak_cpu_window_percent"], "30.00")
        self.assertEqual(fields["peak_memory_window_percent"], "50.00")

    def test_cpu_window_at_69_9_passes_and_70_1_fails(self):
        status, fields = self.evaluate(steady(69.9, 50))
        self.assertEqual((status, fields["result"]), (0, "pass"))
        self.assertEqual(fields["peak_cpu_window_percent"], "69.90")
        status, fields = self.evaluate(steady(70.1, 50))
        self.assertEqual((status, fields["result"]), (4, "fail:cpu"))

    def test_memory_window_at_79_9_passes_and_80_1_fails(self):
        status, fields = self.evaluate(steady(10, 79.9))
        self.assertEqual((status, fields["result"]), (0, "pass"))
        status, fields = self.evaluate(steady(10, 80.1))
        self.assertEqual((status, fields["result"]), (4, "fail:memory"))

    def test_short_cpu_spike_inside_a_calm_window_passes(self):
        rows = steady(20, 50, minutes=30)
        # One minute at 100% CPU: no 15-minute window averages above 70%.
        for r in rows[60:]:
            r[1] += 4 * 800
        status, fields = self.evaluate(rows)
        self.assertEqual((status, fields["result"]), (0, "pass"))

    def test_any_window_over_the_limit_fails(self):
        rows = steady(20, 50, minutes=30)
        # The last 15 minutes run at 90%.
        for index, r in enumerate(rows[60:], start=1):
            r[1] += index * 700
        status, fields = self.evaluate(rows)
        self.assertEqual((status, fields["result"]), (4, "fail:cpu"))

    def test_any_swap_in_or_out_fails(self):
        for counter in ("swap_in", "swap_out"):
            status, fields = self.evaluate(steady(10, 40, **{counter: 1}))
            self.assertEqual((status, fields["result"]), (4, "fail:swap"), counter)
        # A non-zero counter that does not move is not swapping now.
        rows = steady(10, 40)
        for r in rows:
            r[5] += 500
        self.assertEqual(self.evaluate(rows)[1]["result"], "pass")

    def test_an_oom_kill_fails_first(self):
        status, fields = self.evaluate(steady(90, 90, oom=1, swap_in=3))
        self.assertEqual((status, fields["result"]), (4, "fail:oom"))
        self.assertEqual(fields["breaches"], "oom,swap,cpu,memory")
        self.assertEqual(fields["oom_kill_delta"], "1")

    def test_less_than_fifteen_minutes_of_samples_fails(self):
        status, fields = self.evaluate(steady(10, 40, minutes=14))
        self.assertEqual((status, fields["result"]), (4, "fail:insufficient-samples"))
        self.assertEqual(fields["windows"], "0")
        status, fields = self.evaluate(steady(10, 40, minutes=15))
        self.assertEqual((status, fields["result"]), (0, "pass"))
        self.assertEqual(fields["windows"], "1")

    def test_unusable_files_are_refused(self):
        rows = steady(10, 40)
        rows[3][2] = 0  # a counter that goes backwards
        self.assertEqual(self.evaluate(rows)[0], 2)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.tsv"
            path.write_text("epoch\n1\n", encoding="ascii")
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                self.assertEqual(rehearsal.main(["evaluate", str(path)]), 2)


class SampleTests(unittest.TestCase):
    def fake_proc(self, directory, vmstat_extra=""):
        proc = Path(directory)
        (proc / "stat").write_text(
            "cpu  100 5 50 800 20 3 2 0 7 0\ncpu0 100 5 50 800 20 3 2 0 7 0\nintr 1\n", encoding="ascii"
        )
        (proc / "meminfo").write_text(
            "MemTotal:        8000000 kB\nMemFree:          500000 kB\nMemAvailable:    6000000 kB\n", encoding="ascii"
        )
        (proc / "vmstat").write_text(f"nr_free_pages 1\npswpin 4\npswpout 5\n{vmstat_extra}", encoding="ascii")
        return proc

    def test_sample_reads_the_counters(self):
        with tempfile.TemporaryDirectory() as directory:
            proc = self.fake_proc(directory, "oom_kill 2\n")
            out = StringIO()
            with redirect_stdout(out):
                status = rehearsal.main(["sample", "--proc", str(proc), "--interval", "0", "--minutes", "1", "--samples", "2"])
        self.assertEqual(status, 0)
        lines = out.getvalue().splitlines()
        self.assertEqual(lines[0], HEADER)
        self.assertEqual(len(lines), 3)
        fields = lines[1].split("\t")
        # busy = total (980) - idle (800) - iowait (20); guest is inside user.
        self.assertEqual(fields[1:], ["160", "980", "8000000", "6000000", "4", "5", "2"])

    def test_a_missing_oom_counter_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            proc = self.fake_proc(directory)
            err = StringIO()
            with redirect_stdout(StringIO()), redirect_stderr(err):
                status = rehearsal.main(["sample", "--proc", str(proc), "--interval", "0", "--minutes", "1", "--samples", "1"])
        self.assertEqual(status, 2)
        self.assertIn("oom_kill", err.getvalue())

    def test_termination_before_the_planned_count_leaves_complete_rows(self):
        saved = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
        try:
            for sig, expected in ((signal.SIGTERM, 143), (signal.SIGINT, 130)):
                with tempfile.TemporaryDirectory() as directory:
                    proc = self.fake_proc(directory, "oom_kill 0\n")
                    out = StringIO()
                    timer = threading.Timer(0.5, signal.raise_signal, (sig,))
                    timer.start()
                    with redirect_stdout(out):
                        status = rehearsal.main(["sample", "--proc", str(proc), "--interval", "0.2", "--minutes", "1"])
                    timer.join()
                self.assertEqual(status, expected)
                lines = out.getvalue().splitlines()
                self.assertEqual(lines[0], HEADER)
                # Stopped well before the planned 301 samples, every row whole.
                self.assertTrue(2 <= len(lines) < 50, len(lines))
                self.assertTrue(out.getvalue().endswith("\n"))
                for line in lines[1:]:
                    self.assertEqual(len(line.split("\t")), len(rehearsal.COLUMNS))
        finally:
            for sig, handler in saved.items():
                signal.signal(sig, handler)

    def test_non_finite_arguments_are_refused(self):
        for argv in (["--minutes", "nan"], ["--minutes", "inf"], ["--interval", "inf"], ["--interval", "nan"]):
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                status = rehearsal.main(["sample", "--proc", ".", "--samples", "1", *argv])
            self.assertEqual(status, 2, argv)


class Handler(http.server.BaseHTTPRequestHandler):
    methods = []
    paths = []
    fail_every = 0
    count = 0
    lock = threading.Lock()

    def answer(self, body):
        with Handler.lock:
            Handler.count += 1
            Handler.methods.append(self.command)
            Handler.paths.append(self.path)
            failing = Handler.fail_every and Handler.count % Handler.fail_every == 0
        self.send_response(500 if failing else 200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):  # noqa: N802 - http.server API
        if self.path == "/redirect":
            with Handler.lock:
                Handler.count += 1
                Handler.methods.append(self.command)
                Handler.paths.append(self.path)
            self.send_response(302)
            self.send_header("Location", "/never-requested")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.answer(b"ok")

    def do_HEAD(self):  # noqa: N802 - http.server API
        self.answer(b"")

    def do_POST(self):  # noqa: N802 - http.server API
        self.answer(b"never")

    def log_message(self, *args):
        pass


class LoadgenTests(unittest.TestCase):
    def setUp(self):
        Handler.methods = []
        Handler.paths = []
        Handler.count = 0
        Handler.fail_every = 0
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def loadgen(self, *extra):
        out = StringIO()
        with redirect_stdout(out), redirect_stderr(StringIO()):
            status = rehearsal.main(
                ["loadgen", "--url", self.url, "--expect-address", "127.0.0.1", "--concurrency", "4", "--minutes", "0.01", *extra]
            )
        return status, dict(line.split("=", 1) for line in out.getvalue().splitlines())

    def test_clean_run_passes_with_only_reads(self):
        status, fields = self.loadgen("--path", "/", "--path", "/health/live/")
        self.assertEqual(status, 0)
        self.assertEqual(fields["result"], "pass")
        self.assertGreater(int(fields["requests"]), 0)
        self.assertEqual(fields["errors"], "0")
        self.assertIn("p95_ms", fields)
        self.assertEqual(set(Handler.methods), {"GET"})
        for key in ("started_epoch", "finished_epoch", "seconds", "requests_per_second"):
            self.assertIn(key, fields)
        self.assertLessEqual(int(fields["started_epoch"]), int(fields["finished_epoch"]))
        self.assertGreaterEqual(float(fields["seconds"]), 0.5)
        status, fields = self.loadgen("--method", "HEAD")
        self.assertEqual(set(Handler.methods), {"GET", "HEAD"})

    def test_more_than_one_percent_errors_fails(self):
        Handler.fail_every = 10
        status, fields = self.loadgen()
        self.assertEqual(status, 4)
        self.assertEqual(fields["result"], "fail:load-errors")
        self.assertGreater(float(fields["error_rate_percent"]), 1.0)

    def test_a_redirect_is_an_answer_and_is_not_followed(self):
        status, fields = self.loadgen("--path", "/redirect")
        self.assertEqual((status, fields["result"]), (0, "pass"))
        self.assertEqual(fields["errors"], "0")
        self.assertIn("302:", fields["statuses"])
        self.assertEqual(set(Handler.paths), {"/redirect"})

    def test_errors_do_not_count_toward_latency(self):
        Handler.fail_every = 1
        status, fields = self.loadgen()
        self.assertEqual(status, 4)
        self.assertEqual(fields["p95_ms"], "0.0")

    def test_an_unexpected_address_is_refused_before_any_request(self):
        err = StringIO()
        with redirect_stdout(StringIO()), redirect_stderr(err):
            status = rehearsal.main(["loadgen", "--url", self.url, "--expect-address", "192.0.2.10", "--minutes", "0.01"])
        self.assertEqual(status, 2)
        self.assertIn("not 192.0.2.10", err.getvalue())
        self.assertEqual(Handler.methods, [])

    def test_unreachable_target_fails(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            closed_port = probe.getsockname()[1]
        status, fields = self.loadgen("--url", f"http://127.0.0.1:{closed_port}", "--timeout", "1")
        self.assertEqual(status, 4)
        self.assertEqual(fields["errors"], fields["requests"])

    def test_writes_and_credentials_are_refused(self):
        for argv in (
            ["--method", "POST"],
            ["--url", "http://user:secret@127.0.0.1:1"],
            ["--url", "postgres://127.0.0.1:5432"],
            ["--url", "http://127.0.0.1:1/path"],
            ["--url", "http://127.0.0.1:99999"],
            ["--url", "http://127.0.0.1:port"],
            ["--timeout", "0"],
            ["--timeout", "301"],
            ["--timeout", "nan"],
            ["--timeout", "inf"],
            ["--path", "/caf\u00e9"],
            ["--path", "/a b"],
            ["--path", "relative"],
            ["--expect-address", "not-an-ip"],
        ):
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                with self.assertRaises(SystemExit) as raised:
                    rehearsal.main(["loadgen", "--url", self.url, "--expect-address", "127.0.0.1", "--minutes", "0.01", *argv])
            self.assertEqual(raised.exception.code, 2, argv)
        for argv in (["--minutes", "nan"], ["--concurrency", "0"]):
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                status = rehearsal.main(["loadgen", "--url", self.url, "--expect-address", "127.0.0.1", *argv])
            self.assertEqual(status, 2, argv)
        with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
            with self.assertRaises(SystemExit) as raised:
                rehearsal.main(["loadgen", "--url", self.url, "--minutes", "0.01"])
        self.assertEqual(raised.exception.code, 2, "--expect-address is required")
        self.assertEqual(Handler.methods, [])

    def test_percentile(self):
        self.assertEqual(rehearsal.percentile([], 0.95), 0.0)
        self.assertEqual(rehearsal.percentile(list(range(1, 101)), 0.95), 95)
        self.assertEqual(rehearsal.percentile([5.0], 0.95), 5.0)


if __name__ == "__main__":
    unittest.main()
