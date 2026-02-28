from app import app
from waitress import serve

print('APP LOADED - serving on port 5000', flush=True)
serve(app, host='0.0.0.0', port=5000, threads=8)
