import os
import shutil
import socket
import subprocess
import sys
import tempfile
from pathlib import Path


def main():
    backend = Path(__file__).resolve().parents[1]
    binaries = Path(os.environ.get("POSTGRES_BIN", r"C:\Program Files\PostgreSQL\18\bin"))
    if not (binaries / "initdb.exe").is_file():
        raise SystemExit("Set POSTGRES_BIN to the PostgreSQL bin directory.")
    cache = (backend / ".pytest_cache").resolve()
    cache.mkdir(exist_ok=True)
    cluster = Path(tempfile.mkdtemp(prefix="postgres-", dir=cache)).resolve()
    assert cluster.parent == cache
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    started = False
    passed = False
    try:
        subprocess.run(
            [
                str(binaries / "initdb.exe"),
                "-D",
                str(cluster / "data"),
                "--auth=trust",
                "--username=dineiq_tests",
                "--no-locale",
                "-E",
                "UTF8",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            creationflags=flags,
        )
        subprocess.run(
            [
                str(binaries / "pg_ctl.exe"),
                "-D",
                str(cluster / "data"),
                "-l",
                str(cluster / "postgres.log"),
                "-o",
                f"-h 127.0.0.1 -p {port}",
                "-w",
                "start",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            creationflags=flags,
        )
        started = True
        environment = {
            **os.environ,
            "DINEIQ_TEST_POSTGRES": "1",
            "DINEIQ_TEST_DATABASE_URL": f"postgresql+psycopg://dineiq_tests@127.0.0.1:{port}/postgres",
        }
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "-q", "--tb=short", *sys.argv[1:]],
            cwd=backend,
            env=environment,
            capture_output=True,
            text=True,
            creationflags=flags,
        )
        print(result.stdout, end="")
        print(result.stderr, end="", file=sys.stderr)
        passed = result.returncode == 0
        return result.returncode
    finally:
        if started:
            subprocess.run(
                [
                    str(binaries / "pg_ctl.exe"),
                    "-D",
                    str(cluster / "data"),
                    "-m",
                    "immediate",
                    "-w",
                    "stop",
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                creationflags=flags,
            )
        if passed:
            assert cluster.resolve().parent == cache
            shutil.rmtree(cluster)
        else:
            print(f"PostgreSQL test diagnostics retained at {cluster}")


if __name__ == "__main__":
    raise SystemExit(main())
