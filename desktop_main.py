import sys
import threading
import time
from PySide6.QtWidgets import QApplication, QMainWindow
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtCore import QUrl, QTimer
from PySide6.QtGui import QIcon

# Import the existing Flask app
from app import app
import sys
import os

# Fix for PyInstaller: Config Flask to look in the bundle dir
if getattr(sys, 'frozen', False):
    app.root_path = sys._MEIPASS
    # send_from_directory in app.py uses relative 'static' path, so we must be in the bundle dir
    os.chdir(sys._MEIPASS)

class FlaskThread(threading.Thread):
    def __init__(self):
        super().__init__()
        self.daemon = True

    def run(self):
        print("Starting Flask server in background thread...")
        app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("LEO Planner - Desktop Edition")
        self.resize(1280, 800)

        # Initialize Web Engine
        self.browser = QWebEngineView()
        self.setCentralWidget(self.browser)

        # Initial check timer to see if server is up
        self.check_timer = QTimer()
        self.check_timer.timeout.connect(self.check_server)
        self.check_timer.start(500)  # Check every 500ms
        self.retry_count = 0

        # Start loading
        print("Waiting for server...")
        self.load_page()

    def load_page(self):
        url = QUrl("http://127.0.0.1:5000/isl-simulations")
        self.browser.setUrl(url)

    def check_server(self):
        # QWebEngineView doesn't easily expose HTTP status codes for the main frame load
        # But we can assume if the title is set or URL builds, it's working.
        # Actually, let's just retry loading if it fails.
        pass 
        # For simplicity in this starter, we just rely on the user refreshing if it fails immediately,
        # but typically 1-2 seconds is enough for Flask to start.

    def closeEvent(self, event):
        # Clean up
        super().closeEvent(event)

import os

def resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

if __name__ == "__main__":
    # Start Flask in a background thread
    server_thread = FlaskThread()
    server_thread.start()

    # Give Flask a moment to warm up
    time.sleep(1.0)

    # Start Qt Application
    qt_app = QApplication(sys.argv)
    qt_app.setApplicationName("LEO Planner")
    
    # You can set an app icon here
    qt_app.setWindowIcon(QIcon(resource_path("static/icon/site-icon.png")))

    window = MainWindow()
    window.show()

    print("Desktop App Running. Close the window to exit.")
    sys.exit(qt_app.exec())
