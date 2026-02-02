"""
LEO Constellation Visualization Backend
Flask server with WebSocket for real-time constellation simulation
"""

from flask import Flask, render_template, send_from_directory
from flask_socketio import SocketIO, emit
import threading
import time
import math
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'leo-orbit-viz-secret'
socketio = SocketIO(app, cors_allowed_origins="*")

# Default constellation parameters
constellation_params = {
    "satellites": 458,
    "orbital_planes": 12,
    "inclination": 53.0,  # degrees (typical LEO inclination like Starlink)
    "beam_size": 0.45
}

# Animation state
animation_state = {
    "time_offset": 0.0,
    "is_playing": True,
    "speed": 1.0
}

def generate_constellation(params, time_offset=0.0):
    """
    Generate satellite positions using Walker constellation model.
    Returns list of satellites with lat/lon positions and orbital metadata.
    """
    satellites = []
    total_sats = params["satellites"]
    num_planes = params["orbital_planes"]
    inclination = math.radians(params["inclination"])
    
    if num_planes < 1:
        num_planes = 1
    
    sats_per_plane = total_sats // num_planes
    
    for i in range(total_sats):
        plane_idx = i % num_planes
        sat_idx_in_plane = i // num_planes
        
        # Right Ascension of Ascending Node (evenly distributed)
        raan = (plane_idx / num_planes) * 2 * math.pi
        
        # Mean anomaly (position along orbit) with phase offset and time
        anomaly = (sat_idx_in_plane / max(sats_per_plane, 1)) * 2 * math.pi
        anomaly += (plane_idx * 0.5)  # Phase offset between planes
        anomaly += time_offset  # Animation time
        
        # Calculate latitude from orbital mechanics
        sin_lat = math.sin(inclination) * math.sin(anomaly)
        lat = math.asin(max(-1, min(1, sin_lat)))
        
        # Calculate longitude
        y_coord = math.cos(inclination) * math.sin(anomaly)
        x_coord = math.cos(anomaly)
        lon = math.atan2(y_coord, x_coord) + raan
        
        # Normalize longitude to -180 to 180
        lon_deg = math.degrees(lon)
        while lon_deg > 180:
            lon_deg -= 360
        while lon_deg < -180:
            lon_deg += 360
        
        lat_deg = math.degrees(lat)
        
        satellites.append({
            "id": i,
            "lat": lat_deg,
            "lon": lon_deg,
            "plane": plane_idx
        })
    
    return satellites

def generate_orbit_paths(params):
    """
    Generate orbital ground track paths for visualization.
    Returns list of orbit lines, each containing points.
    """
    orbits = []
    num_planes = params["orbital_planes"]
    inclination = math.radians(params["inclination"])
    
    steps = 120  # Points per orbit line
    
    for plane_idx in range(num_planes):
        raan = (plane_idx / num_planes) * 2 * math.pi
        path = []
        
        for i in range(steps + 1):
            anomaly = (i / steps) * 2 * math.pi
            
            sin_lat = math.sin(inclination) * math.sin(anomaly)
            lat = math.asin(max(-1, min(1, sin_lat)))
            
            y_coord = math.cos(inclination) * math.sin(anomaly)
            x_coord = math.cos(anomaly)
            lon = math.atan2(y_coord, x_coord) + raan
            
            lon_deg = math.degrees(lon)
            while lon_deg > 180:
                lon_deg -= 360
            while lon_deg < -180:
                lon_deg += 360
            
            lat_deg = math.degrees(lat)
            path.append({"lat": lat_deg, "lon": lon_deg})
        
        orbits.append(path)
    
    return orbits

# Routes

# Routes
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

# WebSocket Events
@socketio.on('connect')
def handle_connect():
    print('Client connected')
    # Send initial data
    satellites = generate_constellation(constellation_params, animation_state["time_offset"])
    orbits = generate_orbit_paths(constellation_params)
    emit('initial_data', {
        "satellites": satellites,
        "orbits": orbits,
        "params": constellation_params
    })

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

@socketio.on('update_params')
def handle_params_update(data):
    """Handle parameter updates from client sliders"""
    global constellation_params
    
    print(f"Received params update: {data}")
    
    if 'satellites' in data:
        constellation_params['satellites'] = int(data['satellites'])
    if 'orbital_planes' in data:
        constellation_params['orbital_planes'] = int(data['orbital_planes'])
    if 'beam_size' in data:
        constellation_params['beam_size'] = float(data['beam_size'])
    if 'inclination' in data:
        constellation_params['inclination'] = float(data['inclination'])
    
    print(f"Updated constellation_params: {constellation_params}")
    
    # Regenerate orbit paths when planes change
    orbits = generate_orbit_paths(constellation_params)
    satellites = generate_constellation(constellation_params, animation_state["time_offset"])
    
    emit('initial_data', {
        "satellites": satellites,
        "orbits": orbits,
        "params": constellation_params
    }, broadcast=True)

@socketio.on('toggle_play')
def handle_toggle_play():
    """Toggle animation play/pause"""
    global animation_state
    animation_state["is_playing"] = not animation_state["is_playing"]
    emit('play_state', {"is_playing": animation_state["is_playing"]})

@socketio.on('set_speed')
def handle_set_speed(data):
    """Set animation speed"""
    global animation_state
    animation_state["speed"] = float(data.get('speed', 1.0))

if __name__ == '__main__':
    print("Starting LEO Constellation Visualization Server...")
    print("Open http://localhost:5000 in your browser")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)