"""
LEO Constellation Visualization Backend
Flask server for Vercel serverless deployment - Static file serving only
"""

from flask import Flask, render_template, send_from_directory
import math
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'leo-orbit-viz-secret'

# Routes
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/landing')
def landing():
    return render_template('landing.html')

@app.route('/terminal')
def terminal():
    return render_template('terminal.html')

@app.route('/citations')
def citations():
    return render_template('citations.html')

@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

if __name__ == '__main__':
    print("Starting LEO Constellation Visualization Server...")
    print("Open http://localhost:5000 in your browser")
    app.run(host='0.0.0.0', port=5000, debug=True)