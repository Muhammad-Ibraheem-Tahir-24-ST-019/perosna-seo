#!/usr/bin/env python3
"""Tiny static server for this folder.

Identical to `python -m http.server` except it tells the browser never to
cache. Without that, editing app.js and reloading can silently keep running
the old file, which makes tuning maddening.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):      # keep the console readable
        if "200" not in (args[1] if len(args) > 1 else ""):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    root = str(Path(__file__).resolve().parent)
    handler = partial(NoCache, directory=root)
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"serving {root}\n  http://localhost:{port}/index.html")
        print(f"  http://localhost:{port}/selftest.html   (no camera needed)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
