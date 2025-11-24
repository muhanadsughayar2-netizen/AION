from flask import Flask, send_from_directory
import os

app = Flask(__name__, static_folder='landing-page', static_url_path='')

@app.route('/')
def index():
    return send_from_directory('landing-page', 'index.html')

@app.route('/<path:path>')
def serve_file(path):
    return send_from_directory('landing-page', path)

@app.errorhandler(404)
def not_found(e):
    return send_from_directory('landing-page', 'index.html')

if __name__ == '__main__':
    print('✅ Landing page live at: 0.0.0.0:5000')
    app.run(host='0.0.0.0', port=5000, debug=False)
