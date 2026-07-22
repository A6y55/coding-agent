from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import unittest
import uuid


class SidecarTest(unittest.TestCase):
    def test_echo_call_and_shutdown(self) -> None:
        package_root = Path(__file__).resolve().parents[1]
        process = subprocess.Popen(
            [sys.executable, "-u", str(package_root / "sidecar" / "server.py")],
            cwd=package_root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.addCleanup(lambda: process.kill() if process.poll() is None else None)
        assert process.stdin is not None
        assert process.stdout is not None

        call_id = str(uuid.uuid4())
        request = {
            "id": call_id,
            "method": "call",
            "params": {
                "verb": {
                    "name": "local.echo",
                    "preconditions": [],
                    "postconditions": [],
                },
                "implementation": {
                    "id": "python",
                    "backend": "python",
                    "module": "pi_web_verbs_sidecar.verbs.echo",
                    "function": "execute",
                },
                "input": {"message": "ok"},
                "context": {
                    "cwd": str(package_root),
                    "profile": None,
                    "evidenceDir": str(package_root / ".evidence"),
                },
            },
        }
        process.stdin.write(json.dumps(request) + "\n")
        process.stdin.flush()
        response = json.loads(process.stdout.readline())
        self.assertEqual(response["id"], call_id)
        self.assertEqual(response["result"]["output"], {"message": "ok"})

        metadata_call_id = str(uuid.uuid4())
        metadata_request = {
            "id": metadata_call_id,
            "method": "call",
            "params": {
                "verb": {
                    "name": "test.metadata",
                    "preconditions": [],
                    "postconditions": [],
                },
                "implementation": {
                    "id": "python",
                    "backend": "python",
                    "source": str(package_root / "test" / "fixtures" / "metadata_verb.py"),
                    "function": "execute",
                },
                "input": {"message": "wrapped"},
                "context": {
                    "cwd": str(package_root),
                    "profile": None,
                    "evidenceDir": str(package_root / ".evidence"),
                },
            },
        }
        process.stdin.write(json.dumps(metadata_request) + "\n")
        process.stdin.flush()
        metadata_response = json.loads(process.stdout.readline())
        metadata_result = metadata_response["result"]
        self.assertEqual(metadata_result["output"], {"message": "wrapped"})
        self.assertEqual(metadata_result["actualSideEffects"], ["test-observation"])
        self.assertEqual(metadata_result["evidence"]["urls"], ["https://example.test/evidence"])
        self.assertEqual(metadata_result["evidence"]["notes"], ["metadata wrapper decoded"])

        process.stdin.write(json.dumps({"id": "shutdown", "method": "shutdown", "params": {}}) + "\n")
        process.stdin.flush()
        shutdown = json.loads(process.stdout.readline())
        self.assertEqual(shutdown["result"], {"closed": True})
        self.assertEqual(process.wait(timeout=5), 0)
        process.stdin.close()
        process.stdout.close()
        if process.stderr is not None:
            process.stderr.close()


if __name__ == "__main__":
    unittest.main()
