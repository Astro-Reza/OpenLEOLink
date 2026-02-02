"""
LEO Constellation Visualization Backend
Flask server for Vercel serverless deployment
"""

from flask import Flask, render_template, send_from_directory, request, jsonify
import math
import os
import numpy as np
import scipy.stats as stats
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
import io
import base64

app = Flask(__name__)
app.config['SECRET_KEY'] = 'leo-orbit-viz-secret'

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

@app.route('/landing')
def landing():
    return render_template('landing.html')

@app.route('/terminal')
def terminal():
    return render_template('terminal.html')

@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

@app.route('/api/calculate_link_budget', methods=['POST'])
def calculate_link_budget():
    """Run link budget calculation and return results with charts as base64"""
    data = request.json
    
    # Extract parameters
    orbit_params = {
        'altitude_km': float(data.get('altitude', 550)),
        'inclination_deg': float(data.get('inclination', 53))
    }
    ground_params = {
        'lat_deg': float(data.get('latitude', 0)),
        'min_elevation_deg': float(data.get('min_elevation', 10))
    }
    link_params = {
        'frequency_ghz': float(data.get('frequency', 12.0)),
        'eirp_dbw': float(data.get('eirp', 40)),
        'rx_gain_dbi': float(data.get('gr', 35)),
        'required_power_dbw': float(data.get('required_power', -120)),
        'exceedance_prob': float(data.get('exceedance', 0.1))
    }
    
    # Constants
    Re = 6371.0  # Earth Radius
    h = orbit_params['altitude_km']
    inc = np.deg2rad(orbit_params['inclination_deg'])
    lat_es = np.deg2rad(ground_params['lat_deg'])
    theta_min = np.deg2rad(ground_params['min_elevation_deg'])
    
    # Monte Carlo Simulation
    n_samples = 50000
    M = np.random.uniform(0, 2*np.pi, n_samples)
    Omega = np.random.uniform(0, 2*np.pi, n_samples)
    
    r = Re + h
    
    # Satellite position
    x_sat = r * (np.cos(Omega) * np.cos(M) - np.sin(Omega) * np.sin(M) * np.cos(inc))
    y_sat = r * (np.sin(Omega) * np.cos(M) + np.cos(Omega) * np.sin(M) * np.cos(inc))
    z_sat = r * (np.sin(M) * np.sin(inc))
    
    # Earth Station position
    x_es = Re * np.cos(lat_es)
    y_es = 0
    z_es = Re * np.sin(lat_es)
    
    # Slant Range
    rx, ry, rz = x_sat - x_es, y_sat - y_es, z_sat - z_es
    range_km = np.sqrt(rx**2 + ry**2 + rz**2)
    
    # Elevation Angle
    zenith_dot_range = (x_es*rx + y_es*ry + z_es*rz) / Re
    sin_el = zenith_dot_range / range_km
    theta_rad = np.arcsin(np.clip(sin_el, -1, 1))
    
    # Filter visible samples
    valid_indices = theta_rad >= theta_min
    theta_samples = theta_rad[valid_indices]
    slant_range_samples = range_km[valid_indices]
    
    if len(theta_samples) == 0:
        return jsonify({"error": "No visibility. Check parameters."})
    
    # Calculate attenuation
    freq = link_params['frequency_ghz']
    fspl = 92.45 + 20*np.log10(slant_range_samples) + 20*np.log10(freq)
    zenith_loss = 0.5 / np.sin(theta_samples)
    total_attenuation = fspl + zenith_loss
    
    # Received power
    eirp = link_params['eirp_dbw']
    gr = link_params['rx_gain_dbi']
    sys_loss = 2.0
    pr_samples = eirp + gr - total_attenuation - sys_loss
    
    # Statistical metrics
    theta_deg = np.degrees(theta_samples)
    fit_alpha, fit_loc, fit_beta = stats.gamma.fit(theta_deg)
    
    results = {
        "worst_case_pr": float(np.min(pr_samples)),
        "best_case_pr": float(np.max(pr_samples)),
        "expected_pr": float(np.mean(pr_samples)),
        "std_dev_pr": float(np.std(pr_samples)),
        "median_pr": float(np.median(pr_samples)),
        "gamma_alpha": float(fit_alpha),
        "gamma_beta": float(fit_beta),
        "samples_count": int(len(theta_samples)),
        "visibility_ratio": float(len(theta_samples) / n_samples * 100)
    }
    
    p_req = link_params['required_power_dbw']
    results["link_margin_expected"] = float(results["expected_pr"] - p_req)
    results["link_margin_worst"] = float(results["worst_case_pr"] - p_req)
    results["link_margin_best"] = float(results["best_case_pr"] - p_req)
    
    # Generate Charts as Base64
    plt.style.use('dark_background')
    
    # Chart 1: Elevation Angle PDF
    fig1, ax1 = plt.subplots(figsize=(5, 4))
    ax1.hist(theta_deg, 40, density=True, alpha=0.6, color='#00bcd4', label='Monte Carlo Data')
    x = np.linspace(min(theta_deg), max(theta_deg), 100)
    pdf = stats.gamma.pdf(x, fit_alpha, fit_loc, fit_beta)
    ax1.plot(x, pdf, 'r-', lw=2, label=f'Gamma Fit (α={fit_alpha:.2f})')
    ax1.set_xlabel('Elevation Angle (deg)', color='white')
    ax1.set_ylabel('Probability Density', color='white')
    ax1.set_title('Elevation Angle Distribution', color='white')
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    fig1.tight_layout()
    
    buf1 = io.BytesIO()
    fig1.savefig(buf1, format='png', facecolor='#2a2a2a', edgecolor='none', dpi=100)
    buf1.seek(0)
    chart1_b64 = base64.b64encode(buf1.getvalue()).decode('utf-8')
    plt.close(fig1)
    
    # Chart 2: Received Power Box Plot
    fig2, ax2 = plt.subplots(figsize=(5, 4))
    bp = ax2.boxplot(pr_samples, vert=True, patch_artist=True)
    bp['boxes'][0].set_facecolor('#4caf50')
    bp['boxes'][0].set_alpha(0.7)
    ax2.axhline(p_req, color='red', linestyle='--', linewidth=2, label=f'Required ({p_req} dBW)')
    ax2.axhline(results["expected_pr"], color='#00bcd4', linestyle='-.', linewidth=2, label=f'Expected ({results["expected_pr"]:.1f} dBW)')
    ax2.set_ylabel('Received Power (dBW)', color='white')
    ax2.set_title('Power Distribution', color='white')
    ax2.set_xticklabels([''])
    ax2.legend(loc='upper right')
    ax2.grid(True, alpha=0.3)
    fig2.tight_layout()
    
    buf2 = io.BytesIO()
    fig2.savefig(buf2, format='png', facecolor='#2a2a2a', edgecolor='none', dpi=100)
    buf2.seek(0)
    chart2_b64 = base64.b64encode(buf2.getvalue()).decode('utf-8')
    plt.close(fig2)
    
    # Chart 3: Slant Range vs Elevation
    fig3, ax3 = plt.subplots(figsize=(5, 4))
    ax3.scatter(theta_deg[::100], slant_range_samples[::100], alpha=0.5, s=5, c='#ff9800')
    ax3.set_xlabel('Elevation Angle (deg)', color='white')
    ax3.set_ylabel('Slant Range (km)', color='white')
    ax3.set_title('Range vs Elevation', color='white')
    ax3.grid(True, alpha=0.3)
    fig3.tight_layout()
    
    buf3 = io.BytesIO()
    fig3.savefig(buf3, format='png', facecolor='#2a2a2a', edgecolor='none', dpi=100)
    buf3.seek(0)
    chart3_b64 = base64.b64encode(buf3.getvalue()).decode('utf-8')
    plt.close(fig3)
    
    # Chart 4: Path Loss Histogram
    fig4, ax4 = plt.subplots(figsize=(5, 4))
    ax4.hist(total_attenuation, 40, alpha=0.7, color='#e91e63')
    ax4.axvline(np.mean(total_attenuation), color='white', linestyle='--', linewidth=2, label=f'Mean: {np.mean(total_attenuation):.1f} dB')
    ax4.set_xlabel('Total Path Loss (dB)', color='white')
    ax4.set_ylabel('Frequency', color='white')
    ax4.set_title('Path Loss Distribution', color='white')
    ax4.legend()
    ax4.grid(True, alpha=0.3)
    fig4.tight_layout()
    
    buf4 = io.BytesIO()
    fig4.savefig(buf4, format='png', facecolor='#2a2a2a', edgecolor='none', dpi=100)
    buf4.seek(0)
    chart4_b64 = base64.b64encode(buf4.getvalue()).decode('utf-8')
    plt.close(fig4)
    
    results["charts"] = {
        "elevation_pdf": chart1_b64,
        "power_boxplot": chart2_b64,
        "range_elevation": chart3_b64,
        "path_loss": chart4_b64
    }
    
    return jsonify(results)

if __name__ == '__main__':
    print("Starting LEO Constellation Visualization Server...")
    print("Open http://localhost:5000 in your browser")
    app.run(host='0.0.0.0', port=5000, debug=True)