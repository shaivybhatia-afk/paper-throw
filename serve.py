# Local dev server that tells the browser not to cache, so edits always show up.
# Usage: python3 serve.py [port]
import functools, http.server, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
handler = functools.partial(NoCache, directory=os.path.dirname(os.path.abspath(__file__)))
http.server.ThreadingHTTPServer(('', port), handler).serve_forever()
