import numpy as np
import scipy.stats as stats
import matplotlib.pyplot as plt

# --- 1. THE SIMULATION ENGINE (Must run this first) ---
class LeoLinkBudget:
    def __init__(self, orbital_params, ground_params, link_params):
        # 1. Orbital Parameters
        self.h = orbital_params['altitude_km']
        self.Re = 6371.0  # Earth Radius in km

        # 2. Ground Segment
        self.lat_es = np.deg2rad(ground_params['lat_deg'])
        self.theta_min = np.deg2rad(ground_params['min_elevation_deg'])
        self.inc = np.deg2rad(orbital_params['inclination_deg'])

        # 3. Link & Hardware Specs
        self.freq_ghz = link_params['frequency_ghz']
        self.eirp_dbw = link_params['eirp_dbw']
        self.gr_dbi = link_params['rx_gain_dbi']
        self.sys_loss_db = link_params.get('system_losses_db', 2.0)

        # Simulation Arrays
        self.theta_samples = []
        self.slant_range_samples = []

    def _generate_geometry_samples(self, n_samples=10000):
        # Monte Carlo Sampling (Simplified for this example)
        M = np.random.uniform(0, 2*np.pi, n_samples)
        Omega = np.random.uniform(0, 2*np.pi, n_samples)
        r = self.Re + self.h

        # Sat Position
        x_sat = r * (np.cos(Omega) * np.cos(M) - np.sin(Omega) * np.sin(M) * np.cos(self.inc))
        y_sat = r * (np.sin(Omega) * np.cos(M) + np.cos(Omega) * np.sin(M) * np.cos(self.inc))
        z_sat = r * (np.sin(M) * np.sin(self.inc))

        # ES Position
        x_es, y_es, z_es = self.Re * np.cos(self.lat_es), 0, self.Re * np.sin(self.lat_es)

        # Range & Angle
        rx, ry, rz = x_sat - x_es, y_sat - y_es, z_sat - z_es
        range_km = np.sqrt(rx**2 + ry**2 + rz**2)
        zenith_dot_range = (x_es*rx + y_es*ry + z_es*rz) / self.Re
        sin_el = zenith_dot_range / range_km
        theta_rad = np.arcsin(np.clip(sin_el, -1, 1))

        # Filter visible
        valid = theta_rad >= self.theta_min
        self.theta_samples = theta_rad[valid]
        self.slant_range_samples = range_km[valid]

    def analyze(self):
        # Run simulation to populate data
        self._generate_geometry_samples()

# --- 2. THE WATERFALL PLOTTER ---
def plot_link_budget_waterfall(sim_object):
    # A. EIRP (Starting Power)
    eirp = sim_object.eirp_dbw

    # B. Free Space Path Loss (Average)
    fspl_samples = 92.45 + 20*np.log10(sim_object.slant_range_samples) + 20*np.log10(sim_object.freq_ghz)
    avg_fspl = -np.mean(fspl_samples)

    # C. Atmospheric Loss (Average)
    avg_atmos = -np.mean(0.5 / np.sin(sim_object.theta_samples))

    # D. Receiver Gain & Misc Loss
    rx_gain = sim_object.gr_dbi
    sys_loss = -sim_object.sys_loss_db

    # F. Final Received Power
    final_pr = eirp + avg_fspl + avg_atmos + rx_gain + sys_loss

    # Define Steps
    steps = [
        ("Tx EIRP",      eirp,       "start"),
        ("Path Loss",    avg_fspl,   "loss"),
        ("Atmos Loss",   avg_atmos,  "loss"),
        ("Rx Gain",      rx_gain,    "gain"),
        ("Misc Loss",    sys_loss,   "loss"),
        ("Received\nPower", final_pr,   "end")
    ]

    # Calculate Plot Coordinates
    values = [s[1] for s in steps]
    labels = [s[0] for s in steps]
    types  = [s[2] for s in steps]
    bottoms, heights = [], []
    running_total = 0

    for val, type_ in zip(values, types):
        if type_ in ["start", "end"]:
            bottoms.append(0)
            heights.append(val)
            running_total = val
        else:
            bottoms.append(running_total)
            heights.append(val)
            running_total += val

    # Plotting
    fig, ax = plt.subplots(figsize=(12, 7))
    colors = ['#1f77b4' if t in ["start", "end"] else '#2ca02c' if v >= 0 else '#d62728' for t, v in zip(types, values)]
    bars = ax.bar(labels, heights, bottom=bottoms, color=colors, edgecolor='black', width=0.6)

    # Connecting Lines
    for i in range(len(steps) - 1):
        level = values[i] if types[i] in ["start", "end"] else bottoms[i] + heights[i]
        ax.plot([i+0.3, i+0.7], [level, level], 'k--', linewidth=1, alpha=0.5)

    # Labels
    for bar, val in zip(bars, values):
        y_pos = bar.get_y() + bar.get_height()/2 if val != 0 else 0
        if abs(val) < 15:
            text_y = bar.get_y() + bar.get_height() if val > 0 else bar.get_y()
            ax.text(bar.get_x() + bar.get_width()/2, text_y, f"{val:+.1f}", ha='center', va='bottom' if val>0 else 'top', fontsize=10, fontweight='bold')
        else:
            ax.text(bar.get_x() + bar.get_width()/2, y_pos, f"{val:+.1f}", ha='center', va='center', color='white', fontsize=10, fontweight='bold')

    ax.axhline(0, color='black', linewidth=1)
    ax.set_ylabel("Signal Power (dBW)")
    ax.set_title("Link Budget Waterfall (Expected Performance)", fontsize=14)
    ax.grid(axis='y', linestyle='--', alpha=0.3)
    plt.show()

# --- 3. RUN THE CODE ---
# Configuration
orbit_conf = {'altitude_km': 1000, 'inclination_deg': 50}
ground_conf = {'lat_deg': 40.71, 'min_elevation_deg': 10}
link_conf = {'frequency_ghz': 20.0, 'eirp_dbw': 56.0, 'rx_gain_dbi': 40.0}

# Initialize and Run Analysis
link_sim = LeoLinkBudget(orbit_conf, ground_conf, link_conf)
link_sim.analyze()  # <--- This creates the data needed for the plot

# Create Plot
plot_link_budget_waterfall(link_sim)