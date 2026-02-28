import threading

_real_app = None
_load_error = None
_app_ready = threading.Event()

def proxy(environ, start_response):
    if _app_ready.is_set():
        if _load_error is not None:
            msg = f'Startup error: {_load_error}'.encode()
            start_response('500 Internal Server Error', [
                ('Content-Type', 'text/plain'),
                ('Content-Length', str(len(msg)))
            ])
            return [msg]
        return _real_app(environ, start_response)
    # App still loading - return 200 so health checks pass
    start_response('200 OK', [('Content-Type', 'text/plain'), ('Content-Length', '2')])
    return [b'OK']

def load_real_app():
    global _real_app, _load_error
    try:
        from app import app
        _real_app = app
        print('REAL APP LOADED', flush=True)
    except Exception as e:
        _load_error = str(e)
        print(f'APP LOAD FAILED: {e}', flush=True)
    finally:
        _app_ready.set()

threading.Thread(target=load_real_app, daemon=True).start()

from waitress import serve
print('PORT 5000 OPEN', flush=True)
serve(proxy, host='0.0.0.0', port=5000, threads=8)
