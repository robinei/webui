#!/usr/bin/env python

import time
import argparse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


parser = argparse.ArgumentParser(prog='Development server', description='Serves current directory')
parser.add_argument('-s', '--slow', action='store_true', help='Delay all GETs by 1 second (for debugging loading concurrency)')
args = parser.parse_args()


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if args.slow:
            time.sleep(1)
        super().do_GET()

    def send_error(self, code, message=None, explain=None):
        if code != 404:
            super().send_error(code, message, explain)
        else:
            self.path = '/index.html'
            super().do_GET()


print('Serving on http://localhost:3000')
ThreadingHTTPServer(('', 3000), Handler).serve_forever()
