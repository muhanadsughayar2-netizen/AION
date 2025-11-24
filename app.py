from http.server import HTTPServer, SimpleHTTPRequestHandler
import os

os.chdir('landing-page')

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/' or self.path == '':
            self.path = '/index.html'
        return SimpleHTTPRequestHandler.do_GET(self)

if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', 5000), Handler)
    print('✅ Landing page live at: 0.0.0.0:5000')
    server.serve_forever()
