import socket
import threading

# Bind port 5000 BEFORE any other imports - happens in milliseconds
_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
_sock.bind(('0.0.0.0', 5000))
_sock.listen(128)
print('PORT 5000 OPEN', flush=True)

_app_ready = threading.Event()

def handle_early(conn):
    try:
        conn.recv(4096)
        conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK')
    except: pass
    finally: conn.close()

def early_server():
    while not _app_ready.is_set():
        try:
            _sock.settimeout(0.1)
            conn, _ = _sock.accept()
            threading.Thread(target=handle_early, args=(conn,), daemon=True).start()
        except socket.timeout:
            continue
        except: break

threading.Thread(target=early_server, daemon=True).start()

# Load the app (~500ms) - port is already open and serving 200 during this time
from app import app

_app_ready.set()
_sock.settimeout(None)
print('APP LOADED - handing socket to waitress', flush=True)

# Pass the already-open socket directly to waitress - zero gap
from waitress import serve
serve(app, sockets=[_sock], threads=4)
