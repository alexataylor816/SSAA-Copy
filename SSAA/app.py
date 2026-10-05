#!/usr/bin/env python3
"""
Local host for the SSAA web app (Vite + React build in ./dist).

Usage:
    python3 app.py                 serve ./dist and open the browser
    python3 app.py --build         rebuild ./dist first, then serve
    python3 app.py --dev           run the Vite dev server with hot reload
    python3 app.py --port 3000     serve on a specific port
    python3 app.py --no-browser    do not open the browser automatically
"""

import argparse
import http.server
import os
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import time
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "dist")
DEFAULT_PORTS = [8080, 8081, 8082, 3000]

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".eot": "application/vnd.ms-fontobject",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json",
}


def find_node():
    candidates = []
    bundled = os.path.expanduser("~/.local/node/bin")
    if os.path.isdir(bundled):
        candidates.append(bundled)
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if entry:
            candidates.append(entry)

    for name in ("node", "npm", "npx"):
        found = shutil.which(name, path=os.pathsep.join(candidates))
        if not found:
            return None
        os.environ["PATH"] = bundled + os.pathsep + os.environ.get("PATH", "")
        return bundled
    return None


def run_npm(args, node_bin_dir):
    if not node_bin_dir:
        print("Node.js was not found on this machine.")
        print("Install it, then re-run:  python3 app.py --build")
        print("  macOS:  brew install node   (or download from https://nodejs.org)")
        sys.exit(1)

    env = dict(os.environ)
    env["PATH"] = node_bin_dir + os.pathsep + env.get("PATH", "")
    result = subprocess.run(["npm"] + args, cwd=ROOT, env=env)
    if result.returncode != 0:
        print("\nCommand failed: npm " + " ".join(args))
        sys.exit(result.returncode)


def ensure_build(node_bin_dir):
    if os.path.isfile(os.path.join(DIST, "index.html")):
        return
    print("No build found in ./dist — building now (this can take a minute)...")
    if not os.path.isdir(os.path.join(ROOT, "node_modules")):
        print("Installing dependencies...")
        run_npm(["install"], node_bin_dir)
    run_npm(["run", "build"], node_bin_dir)


def pick_port(preferred, host):
    ports = [preferred] + [p for p in DEFAULT_PORTS if p != preferred]
    for port in ports:
        if port < 1 or port > 65535:
            continue
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind((host, port))
                return port
            except OSError:
                continue
    raise SystemExit("No free port found. Try:  python3 app.py --port 3000")


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        kwargs["directory"] = DIST
        super().__init__(*args, **kwargs)

    def translate_path(self, path):
        full = super().translate_path(path)
        if os.path.isfile(full):
            return full
        if os.path.isdir(full):
            index = os.path.join(full, "index.html")
            if os.path.isfile(index):
                return index
        if not os.path.splitext(path)[1]:
            return os.path.join(DIST, "index.html")
        return full

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        if ext in MIME_TYPES:
            return MIME_TYPES[ext]
        return super().guess_type(path)

    def end_headers(self):
        if self.path in ("/", "/index.html") or not os.path.splitext(self.path)[1]:
            self.send_header("Cache-Control", "no-store, must-revalidate")
        else:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "304" in (args[1] if len(args) > 1 else ""):
            return
        sys.stdout.write("  %s\n" % (fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def serve(port, host, open_browser):
    with Server((host, port), SPAHandler) as httpd:
        shown = host if host not in ("0.0.0.0", "::") else "localhost"
        url = "http://%s:%d/dashboard" % (shown, port)

        print()
        print("  SSAA is running locally")
        print("  ------------------------")
        print("  Dashboard : %s" % url)
        print("  Landing   : http://%s:%d/" % (shown, port))
        print("  Network   : http://<your-lan-ip>:%d/" % port)
        print("  Stop      : press Ctrl+C")
        print()

        if open_browser:
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Shutting down.")
            httpd.shutdown()


def run_dev(node_bin_dir, port, open_browser):
    if not node_bin_dir:
        print("The dev server needs Node.js. Install it, then re-run:  python3 app.py --dev")
        print("  macOS:  brew install node   (or download from https://nodejs.org)")
        sys.exit(1)

    env = dict(os.environ)
    env["PATH"] = node_bin_dir + os.pathsep + env.get("PATH", "")
    if not os.path.isdir(os.path.join(ROOT, "node_modules")):
        print("Installing dependencies...")
        run_npm(["install"], node_bin_dir)

    if open_browser:
        threading.Timer(3.0, lambda: webbrowser.open("http://localhost:%d/dashboard" % port)).start()

    print("\n  Starting the dev server with hot reload on port %d" % port)
    print("  Press Ctrl+C to stop.\n")
    try:
        subprocess.run(["npm", "run", "dev", "--", "--port", str(port)], cwd=ROOT, env=env)
    except KeyboardInterrupt:
        print("\n  Shutting down.")


def main():
    parser = argparse.ArgumentParser(
        description="Host the SSAA app locally.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--build", action="store_true", help="rebuild ./dist before serving")
    parser.add_argument("--dev", action="store_true", help="run the Vite dev server with hot reload")
    parser.add_argument("--port", type=int, default=8080, help="port to listen on (default 8080)")
    parser.add_argument("--host", default="127.0.0.1", help="interface to bind (default 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser")
    args = parser.parse_args()

    if not os.path.isfile(os.path.join(ROOT, ".env")):
        print("WARNING: .env not found — Supabase connection details will be missing.")

    node_bin_dir = find_node()

    if args.dev:
        run_dev(node_bin_dir, args.port, not args.no_browser)
        return

    if args.build:
        ensure_build(node_bin_dir)
    elif not os.path.isfile(os.path.join(DIST, "index.html")):
        ensure_build(node_bin_dir)

    port = pick_port(args.port, args.host)
    serve(port, args.host, not args.no_browser)


if __name__ == "__main__":
    main()
