#!/usr/bin/env python3
"""Capacity sampling, evaluation, and a read-only HTTP load generator.

Standard library only; deploy/rehearse.sh drives it on the host, and the
operator runs ``loadgen`` from a workstation.

  rehearsal.py sample --proc DIR --interval S --minutes M [--samples N]
      Read DIR/stat, DIR/meminfo, and DIR/vmstat every S seconds for M
      minutes (or exactly N samples) and print one TSV row per sample:
      epoch, busy and total CPU jiffies, MemTotal and MemAvailable (kB),
      and the pswpin, pswpout, and oom_kill counters.

  rehearsal.py evaluate TSV
      Apply the architecture AD-2 thresholds to a sample file and print
      key=value lines. Exit 0 when they hold, 4 on a breach, 2 when the
      file is unusable.

  rehearsal.py loadgen --url URL --expect-address IP [--concurrency 20]
                       [--minutes 30] [--path P ...] [--method GET|HEAD]
      Refuse unless the URL host resolves to IP, then send only GET or HEAD
      requests from worker threads and print the request count, error rate,
      95th-percentile latency of the answered requests, and the load window
      as key=value lines. Exit 4 when more than 1% of the requests fail, 130
      (after a partial summary) on Ctrl-C.
"""

from __future__ import annotations

import argparse
import ipaddress
import math
import signal
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Architecture AD-2 thresholds. Changing them needs an explicit decision.
WINDOW_SECONDS = 900
CPU_LIMIT_PERCENT = 70.0
MEMORY_LIMIT_PERCENT = 80.0
ERROR_LIMIT_PERCENT = 1.0

COLUMNS = (
    "epoch",
    "cpu_busy",
    "cpu_total",
    "mem_total_kb",
    "mem_available_kb",
    "pswpin",
    "pswpout",
    "oom_kill",
)
METHODS = ("GET", "HEAD")


class SampleError(Exception):
    """A /proc file or a sample file cannot be used."""


# --- sample --------------------------------------------------------------------


def read_cpu(proc: Path) -> tuple[int, int]:
    """Busy and total jiffies from the aggregate cpu line of /proc/stat.

    The total covers user..steal; guest time is already counted in user and
    nice. Idle and iowait are not busy.
    """
    for line in (proc / "stat").read_text(encoding="ascii").splitlines():
        fields = line.split()
        if fields and fields[0] == "cpu":
            values = [int(value) for value in fields[1:9]]
            if len(values) < 4:
                raise SampleError("the cpu line of stat is too short")
            values += [0] * (8 - len(values))
            total = sum(values)
            idle = values[3] + values[4]
            return total - idle, total
    raise SampleError("stat has no aggregate cpu line")


def read_keyed(path: Path, separator: str | None) -> dict[str, int]:
    values: dict[str, int] = {}
    for line in path.read_text(encoding="ascii").splitlines():
        if separator:
            key, _, rest = line.partition(separator)
            parts = rest.split()
        else:
            key, *parts = line.split() or [""]
        if key and parts and parts[0].isdigit():
            values[key.strip()] = int(parts[0])
    return values


def read_sample(proc: Path, epoch: int) -> list[int]:
    busy, total = read_cpu(proc)
    meminfo = read_keyed(proc / "meminfo", ":")
    vmstat = read_keyed(proc / "vmstat", None)
    try:
        return [
            epoch,
            busy,
            total,
            meminfo["MemTotal"],
            meminfo["MemAvailable"],
            vmstat["pswpin"],
            vmstat["pswpout"],
            vmstat["oom_kill"],
        ]
    except KeyError as missing:
        raise SampleError(f"a required counter is missing: {missing.args[0]}") from None


def cmd_sample(args: argparse.Namespace) -> int:
    """Print the samples; a SIGTERM or SIGINT ends the run early with 143 or
    130 after the last complete row."""
    proc = Path(args.proc)
    if not (math.isfinite(args.interval) and math.isfinite(args.minutes)):
        raise SampleError("--interval and --minutes must be finite")
    if args.interval < 0 or args.minutes <= 0:
        raise SampleError("--interval must be >= 0 and --minutes > 0")
    if args.samples is not None:
        count = args.samples
    elif args.interval > 0:
        count = int(round(args.minutes * 60 / args.interval)) + 1
    else:
        raise SampleError("--interval 0 needs --samples")
    if count < 1:
        raise SampleError("at least one sample is required")
    stop = threading.Event()
    received: list[int] = []

    def finish(signum: int, _frame: object) -> None:
        received.append(signum)
        stop.set()

    signal.signal(signal.SIGTERM, finish)
    signal.signal(signal.SIGINT, finish)
    print("\t".join(COLUMNS), flush=True)
    start = time.monotonic()
    for index in range(count):
        if stop.is_set():
            break
        # Each row is read in full, then written and flushed in one call.
        row = read_sample(proc, int(time.time()))
        sys.stdout.write("\t".join(str(value) for value in row) + "\n")
        sys.stdout.flush()
        if index + 1 == count:
            break
        # Fixed schedule, so slow reads do not stretch the run.
        delay = start + (index + 1) * args.interval - time.monotonic()
        if delay > 0 and stop.wait(delay):
            break
    if received:
        return 130 if received[0] == signal.SIGINT else 143
    return 0


# --- evaluate ------------------------------------------------------------------


def load_samples(path: Path) -> list[list[int]]:
    lines = path.read_text(encoding="ascii").splitlines()
    if not lines or lines[0].split("\t") != list(COLUMNS):
        raise SampleError("the sample file has no valid header")
    rows: list[list[int]] = []
    for line in lines[1:]:
        fields = line.split("\t")
        if len(fields) != len(COLUMNS) or not all(field.isdigit() for field in fields):
            raise SampleError("the sample file has a malformed row")
        rows.append([int(field) for field in fields])
    for previous, current in zip(rows, rows[1:]):
        if current[0] < previous[0] or any(current[i] < previous[i] for i in (1, 2, 5, 6, 7)):
            raise SampleError("the sample counters or clock went backwards")
    for row in rows:
        if row[3] <= 0 or row[4] > row[3]:
            raise SampleError("the sample file has an impossible memory row")
    return rows


def memory_used(row: list[int]) -> float:
    return 100.0 * (1.0 - row[4] / row[3])


def evaluate(rows: list[list[int]]) -> tuple[str, dict[str, str]]:
    """Return the result and the evidence fields for a list of samples.

    Every window starts at a sample and ends at the first sample at least
    WINDOW_SECONDS later. Its CPU is the busy share of the jiffies between
    the two; its memory is the mean of the samples it spans.
    """
    fields: dict[str, str] = {
        "samples": str(len(rows)),
        "first_epoch": str(rows[0][0]) if rows else "",
        "last_epoch": str(rows[-1][0]) if rows else "",
    }
    duration = rows[-1][0] - rows[0][0] if rows else 0
    fields["duration_seconds"] = str(duration)
    breaches: list[str] = []
    peak_cpu = peak_memory = 0.0
    windows = 0
    end = 0
    for start, first in enumerate(rows):
        while end < len(rows) and rows[end][0] - first[0] < WINDOW_SECONDS:
            end += 1
        if end == len(rows):
            break
        last = rows[end]
        jiffies = last[2] - first[2]
        cpu = 100.0 * (last[1] - first[1]) / jiffies if jiffies > 0 else 0.0
        span = rows[start : end + 1]
        memory = sum(memory_used(row) for row in span) / len(span)
        peak_cpu = max(peak_cpu, cpu)
        peak_memory = max(peak_memory, memory)
        windows += 1
    swap_in = rows[-1][5] - rows[0][5] if rows else 0
    swap_out = rows[-1][6] - rows[0][6] if rows else 0
    oom = rows[-1][7] - rows[0][7] if rows else 0
    if oom > 0:
        breaches.append("oom")
    if swap_in > 0 or swap_out > 0:
        breaches.append("swap")
    if peak_cpu > CPU_LIMIT_PERCENT:
        breaches.append("cpu")
    if peak_memory > MEMORY_LIMIT_PERCENT:
        breaches.append("memory")
    if windows == 0:
        breaches.append("insufficient-samples")
    fields.update(
        {
            "windows": str(windows),
            "window_seconds": str(WINDOW_SECONDS),
            "peak_cpu_window_percent": f"{peak_cpu:.2f}",
            "peak_memory_window_percent": f"{peak_memory:.2f}",
            "peak_memory_sample_percent": f"{max((memory_used(r) for r in rows), default=0.0):.2f}",
            "swap_in_delta": str(swap_in),
            "swap_out_delta": str(swap_out),
            "oom_kill_delta": str(oom),
            "cpu_limit_percent": f"{CPU_LIMIT_PERCENT:.0f}",
            "memory_limit_percent": f"{MEMORY_LIMIT_PERCENT:.0f}",
            "breaches": ",".join(breaches),
        }
    )
    result = f"fail:{breaches[0]}" if breaches else "pass"
    return result, fields


def cmd_evaluate(args: argparse.Namespace) -> int:
    result, fields = evaluate(load_samples(Path(args.tsv)))
    print(f"result={result}")
    for key, value in fields.items():
        print(f"{key}={value}")
    return 0 if result == "pass" else 4


# --- loadgen -------------------------------------------------------------------


def checked_url(value: str) -> str:
    parts = urllib.parse.urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise argparse.ArgumentTypeError("--url must be an http or https URL")
    if parts.username or parts.password or "@" in parts.netloc:
        raise argparse.ArgumentTypeError("--url must not carry credentials")
    if parts.query or parts.fragment or parts.path not in ("", "/"):
        raise argparse.ArgumentTypeError("--url is the origin only; pass paths with --path")
    try:
        port = parts.port
    except ValueError:
        raise argparse.ArgumentTypeError("--url has an invalid port") from None
    if port == 0:
        raise argparse.ArgumentTypeError("--url has an invalid port")
    return f"{parts.scheme}://{parts.netloc}"


def checked_path(value: str) -> str:
    if not value.startswith("/") or any(ord(c) < 33 or ord(c) > 126 for c in value):
        raise argparse.ArgumentTypeError("--path must start with / and contain only printable ASCII without spaces")
    return value


def checked_timeout(value: str) -> float:
    try:
        seconds = float(value)
    except ValueError:
        raise argparse.ArgumentTypeError("--timeout must be a number") from None
    if not math.isfinite(seconds) or not 0 < seconds <= 300:
        raise argparse.ArgumentTypeError("--timeout must be more than 0 and at most 300 seconds")
    return seconds


def checked_address(value: str) -> str:
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        raise argparse.ArgumentTypeError("--expect-address must be an IP address") from None


def resolved_addresses(origin: str) -> set[str]:
    parts = urllib.parse.urlsplit(origin)
    port = parts.port or (443 if parts.scheme == "https" else 80)
    answers = socket.getaddrinfo(parts.hostname, port, proto=socket.IPPROTO_TCP)
    return {str(ipaddress.ip_address(answer[4][0].split("%")[0])) for answer in answers}


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, math.ceil(fraction * len(ordered)) - 1)
    return ordered[index]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect is an answer, not a second request: count it and stop."""

    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


def run_load(origin: str, paths: list[str], method: str, concurrency: int, seconds: float, timeout: float) -> tuple[dict[str, str], bool]:
    """Return the summary fields and whether a Ctrl-C cut the run short."""
    opener = urllib.request.build_opener(NoRedirect)
    began_epoch = time.time()
    began = time.monotonic()
    deadline = began + seconds
    stop = threading.Event()
    lock = threading.Lock()
    latencies: list[float] = []
    requests = 0
    errors = 0
    statuses: dict[str, int] = {}

    def worker(offset: int) -> None:
        nonlocal errors, requests
        sequence = offset
        while not stop.is_set() and time.monotonic() < deadline:
            path = paths[sequence % len(paths)]
            sequence += 1
            request = urllib.request.Request(
                origin + path,
                method=method,
                headers={"User-Agent": "mawareeth-rehearsal-loadgen", "Accept": "text/html"},
            )
            sent = time.monotonic()
            try:
                with opener.open(request, timeout=timeout) as response:
                    response.read()
                    status = str(response.status)
                    failed = response.status >= 400
            except urllib.error.HTTPError as error:
                status = str(error.code)
                failed = error.code >= 400
                error.close()
            except Exception:  # noqa: BLE001 - any transport failure is an error
                status = "error"
                failed = True
            elapsed = time.monotonic() - sent
            with lock:
                requests += 1
                statuses[status] = statuses.get(status, 0) + 1
                if failed:
                    errors += 1
                else:
                    # Latency describes answers; failures are counted apart.
                    latencies.append(elapsed)

    threads = [threading.Thread(target=worker, args=(index,), daemon=True) for index in range(concurrency)]
    for thread in threads:
        thread.start()
    interrupted = False
    try:
        while any(thread.is_alive() for thread in threads):
            for thread in threads:
                thread.join(0.2)
    except KeyboardInterrupt:
        interrupted = True
        stop.set()
        # In-flight requests end within their timeout.
        for thread in threads:
            thread.join(timeout + 1)
    elapsed = max(time.monotonic() - began, 1e-9)
    finished_epoch = time.time()
    with lock:
        rate = 100.0 * errors / requests if requests else 100.0
        fields = {
            "requests": str(requests),
            "errors": str(errors),
            "error_rate_percent": f"{rate:.3f}",
            "p95_ms": f"{1000.0 * percentile(latencies, 0.95):.1f}",
            "requests_per_second": f"{requests / elapsed:.2f}",
            "statuses": ",".join(f"{key}:{statuses[key]}" for key in sorted(statuses)),
            "concurrency": str(concurrency),
            "seconds": f"{elapsed:.1f}",
            "started_epoch": str(int(began_epoch)),
            "finished_epoch": str(int(finished_epoch)),
            "method": method,
        }
    return fields, interrupted


def cmd_loadgen(args: argparse.Namespace) -> int:
    if not 1 <= args.concurrency <= 200:
        raise SampleError("--concurrency must be 1-200")
    if not (math.isfinite(args.minutes) and 0 < args.minutes <= 240):
        raise SampleError("--minutes must be > 0 and at most 240")
    # The load must reach the rehearsal host, not Heroku: refuse unless the
    # URL's host currently resolves to the expected address.
    try:
        answers = resolved_addresses(args.url)
    except (OSError, UnicodeError) as error:
        raise SampleError(f"cannot resolve the --url host: {error}") from None
    if args.expect_address not in answers:
        raise SampleError(f"the --url host resolves to {','.join(sorted(answers))}, not {args.expect_address}; point it at the host first")
    fields, interrupted = run_load(args.url, args.path or ["/"], args.method, args.concurrency, args.minutes * 60, args.timeout)
    requests = int(fields["requests"])
    errors = int(fields["errors"])
    # More than 1% failed, compared exactly in integers.
    failed = requests == 0 or errors * 100 > requests * ERROR_LIMIT_PERCENT
    if interrupted:
        result = "fail:interrupted"
    else:
        result = "fail:load-errors" if failed else "pass"
    print(f"result={result}")
    print(f"expect_address={args.expect_address}")
    for key, value in fields.items():
        print(f"{key}={value}")
    sys.stdout.flush()
    if interrupted:
        return 130
    return 4 if failed else 0


# --- main ----------------------------------------------------------------------


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="rehearsal.py", description=__doc__.split("\n")[0])
    commands = root.add_subparsers(dest="command", required=True)

    sample = commands.add_parser("sample", help="sample /proc counters as TSV")
    sample.add_argument("--proc", default="/proc")
    sample.add_argument("--interval", type=float, default=15.0)
    sample.add_argument("--minutes", type=float, default=30.0)
    sample.add_argument("--samples", type=int)
    sample.set_defaults(handler=cmd_sample)

    evaluate_cmd = commands.add_parser("evaluate", help="apply the capacity thresholds to a TSV")
    evaluate_cmd.add_argument("tsv")
    evaluate_cmd.set_defaults(handler=cmd_evaluate)

    load = commands.add_parser("loadgen", help="read-only HTTP load")
    load.add_argument("--url", required=True, type=checked_url)
    load.add_argument("--expect-address", required=True, type=checked_address)
    load.add_argument("--concurrency", type=int, default=20)
    load.add_argument("--minutes", type=float, default=30.0)
    load.add_argument("--path", action="append", type=checked_path)
    load.add_argument("--method", choices=METHODS, default="GET")
    load.add_argument("--timeout", type=checked_timeout, default=10.0)
    load.set_defaults(handler=cmd_loadgen)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        return args.handler(args)
    except (OSError, UnicodeDecodeError, ValueError, SampleError) as error:
        print(f"rehearsal: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
