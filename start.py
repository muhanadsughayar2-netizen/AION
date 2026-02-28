import threading

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
print('PORT 5000 OPEN', flush=True)
serve(proxy, host='0.0.0.0', port=5000, threads=8)
