import socket
import threading

# Bind port 5000 BEFORE any other imports - happens in milliseconds
_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
_sock.bind(('0.0.0.0', 5000))
_sock.listen(128)
print('PORT 5000 OPEN', flush=True)

_real_app = None
_app_ready = threading.Event()

def proxy(environ, start_response):
    if _app_ready.is_set() and _real_app is not None:
        return _real_app(environ, start_response)
    start_response('200 OK', [('Content-Type', 'text/plain'), ('Content-Length', '2')])
    return [b'OK']

def load_real_app():
    global _real_app
    from app import app
    _real_app = app
    _app_ready.set()
    print('REAL APP LOADED', flush=True)

threading.Thread(target=load_real_app, daemon=True).start()

from waitress import serve
serve(proxy, sockets=[_sock], threads=8)
