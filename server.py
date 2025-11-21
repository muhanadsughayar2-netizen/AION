#!/usr/bin/env python3
import http.server
import socketserver
import os
from pathlib import Path

PORT = 5000
DIRECTORY = "flow"

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    if not os.path.exists(DIRECTORY):
        print(f"Error: Directory '{DIRECTORY}' not found!")
        return
    
    with socketserver.TCPServer(("0.0.0.0", PORT), MyHTTPRequestHandler) as httpd:
        print(f"✓ Flow Extension Server Running")
        print(f"✓ Serving files from: {DIRECTORY}/")
        print(f"✓ Server URL: http://0.0.0.0:{PORT}")
        print(f"\n📦 Chrome Extension Files:")
        print(f"   - manifest.json")
        print(f"   - background.js")
        print(f"   - content.js")
        print(f"   - popup.html / popup.css / popup.js")
        print(f"   - utils/capture.js")
        print(f"   - utils/upload.js")
        print(f"   - icons/ (icon16.png, icon48.png, icon128.png)")
        print(f"   - README.md")
        print(f"\n🚀 To install the extension:")
        print(f"   1. Download all files from this server")
        print(f"   2. Open Chrome and go to chrome://extensions/")
        print(f"   3. Enable 'Developer mode'")
        print(f"   4. Click 'Load unpacked' and select the 'flow' folder")
        print(f"\n⌨️  Press Ctrl+C to stop the server")
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\nServer stopped.")

if __name__ == "__main__":
    main()
