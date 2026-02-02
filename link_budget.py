import numpy as np
import scipy.stats as stats
import matplotlib.pyplot as plt

# ==========================================
# CLASS 1: SPATIAL STATISTICAL ANALYSIS
# Calculates Link Budget Expectations
# ==========================================
class LeoLinkBudget:
    def __init__(self, orbital_params, ground_params, link_params):
        """
        Initialize the simulation with parameters.
        """
        # 1. Orbital Parameters
        self.h = orbital_params['altitude_km']
        self.inc = np.deg2rad(orbital_params['inclination_deg'])
        self.Re = 6371.0  # Earth Radius in km
        
        # 2. Ground Segment
        self.lat_es = np.deg2rad(ground_params['lat_deg'])
        self.theta_min = np.deg2rad(ground_params['min_elevation_deg'])
        
        # 3. Link & Hardware Specs
        self.freq_ghz = link_params['frequency_ghz']
        self.eirp_dbw = link_params['eirp_dbw']
        self.gr_dbi = link_params['rx_gain_dbi']
        self.p_req_dbw = link_params['required_power_dbw']
        self.sys_loss_db = link_params.get('system_losses_db', 2.0)
        
        # Simulation Arrays
        self.theta_samples = []
        self.path_loss_samples = []
        self.pr_samples = []

    def _generate_geometry_samples(self, n_samples=50000):
        """
        Monte Carlo Approach: Randomly samples satellite positions over the 
        orbital sphere to build the probability distribution (PDF) of the angle.
        """
        # Random Mean Anomaly and RAAN
        M = np.random.uniform(0, 2*np.pi, n_samples)
        Omega = np.random.uniform(0, 2*np.pi, n_samples)
        
        # Orbit radius
        r = self.Re + self.h
        
        # Satellite position in ECEF (Simplified for statistical distribution)
        x_sat = r * (np.cos(Omega) * np.cos(M) - np.sin(Omega) * np.sin(M) * np.cos(self.inc))
        y_sat = r * (np.sin(Omega) * np.cos(M) + np.cos(Omega) * np.sin(M) * np.cos(self.inc))
        z_sat = r * (np.sin(M) * np.sin(self.inc))
        
        # Earth Station position in ECEF
        x_es = self.Re * np.cos(self.lat_es)
        y_es = 0
        z_es = self.Re * np.sin(self.lat_es)
        
        # Vector Math: Slant Range vector
        rx, ry, rz = x_sat - x_es, y_sat - y_es, z_sat - z_es
        range_km = np.sqrt(rx**2 + ry**2 + rz**2)
        
        # Calculate Elevation Angle (Theta)
        zenith_dot_range = (x_es*rx + y_es*ry + z_es*rz) / self.Re
        sin_el = zenith_dot_range / range_km
        theta_rad = np.arcsin(np.clip(sin_el, -1, 1))
        
        # Filter: Keep only visible samples
        valid_indices = theta_rad >= self.theta_min
        
        self.theta_samples = theta_rad[valid_indices]
        self.slant_range_samples = range_km[valid_indices]
        
        return len(self.theta_samples)

    def _calculate_attenuation(self, theta_rad, distance_km):
        """
        Calculates Total Attenuation (A_T).
        Includes Free Space Path Loss (FSPL) and a simplified Atmospheric Model.
        """
        # 1. Free Space Path Loss
        fspl = 92.45 + 20*np.log10(distance_km) + 20*np.log10(self.freq_ghz)
        
        # 2. Atmospheric Attenuation (Simplified Model)
        # Models baseline loss that increases at low angles (1/sin(theta))
        zenith_loss_db = 0.5 
        atm_loss = zenith_loss_db / np.sin(theta_rad)
        
        total_attenuation = fspl + atm_loss
        return total_attenuation

    def analyze(self):
        """
        Executes the logic described in Section III of the paper.
        """
        # 1. Generate Statistics
        count = self._generate_geometry_samples()
        if count == 0:
            return "No visibility. Check parameters."

        # 2. Fit Gamma Distribution 
        fit_alpha, fit_loc, fit_beta = stats.gamma.fit(np.degrees(self.theta_samples))
        
        # 3. Calculate Power for every sample
        attenuation = self._calculate_attenuation(self.theta_samples, self.slant_range_samples)
        self.pr_samples = self.eirp_dbw + self.gr_dbi - attenuation - self.sys_loss_db
        
        # 4. Compute Statistical Metrics
        results = {
            "worst_case_pr": np.min(self.pr_samples),
            "best_case_pr": np.max(self.pr_samples),
            "expected_pr": np.mean(self.pr_samples),
            "std_dev_pr": np.std(self.pr_samples),
            "median_pr": np.median(self.pr_samples),
            "gamma_params": (fit_alpha, fit_beta)
        }
        
        # Calculate Link Margin
        results["link_margin_expected"] = results["expected_pr"] - self.p_req_dbw
        results["link_margin_worst"] = results["worst_case_pr"] - self.p_req_dbw
        
        return results

    def plot_results(self):
        """
        Visualizes Gamma PDF of Angle and Boxplot of Power.
        """
        theta_deg = np.degrees(self.theta_samples)
        
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
        
        # Plot 1: Gamma Distribution of Angles
        count, bins, ignored = ax1.hist(theta_deg, 50, density=True, alpha=0.6, color='skyblue', label='Monte Carlo Data')
        alpha, loc, beta = stats.gamma.fit(theta_deg)
        x = np.linspace(min(theta_deg), max(theta_deg), 100)
        pdf = stats.gamma.pdf(x, alpha, loc, beta)
        ax1.plot(x, pdf, 'r-', lw=2, label=f'Gamma Fit\na={alpha:.2f}, b={beta:.2f}')
        ax1.set_xlabel('Elevation Angle (deg)')
        ax1.set_ylabel('Probability')
        ax1.set_title('Probability Density of Elevation Angle')
        ax1.legend()
        ax1.grid(True, alpha=0.3)

        # Plot 2: Received Power Statistics
        ax2.boxplot(self.pr_samples, vert=True, patch_artist=True, boxprops=dict(facecolor="lightgreen"))
        ax2.set_ylabel('Received Power (dBW)')
        ax2.set_xticklabels(['Statistical Distribution'])
        ax2.set_title('Received Power Variation')
        
        # Add Reference Lines
        ax2.axhline(self.p_req_dbw, color='red', linestyle='--', linewidth=2, label=f'Required ({self.p_req_dbw} dBW)')
        ax2.axhline(np.mean(self.pr_samples), color='blue', linestyle='-.', linewidth=2, label=f'Expected E[P_R] ({np.mean(self.pr_samples):.1f} dBW)')
        ax2.legend()
        ax2.grid(True, alpha=0.3)
        
        plt.tight_layout()
        plt.show()

# ==========================================
# CLASS 2: TIME-SERIES ANALYSIS
# Calculates Contact Durations & Error Stats
# ==========================================
class LeoTimeSeriesAnalysis:
    def __init__(self, orbit_params, ground_params):
        # Constants
        self.Re = 6371.0
        self.GM = 3.986e5
        
        # Configuration
        self.h = orbit_params['altitude_km']
        self.inc = np.deg2rad(orbit_params['inclination_deg'])
        self.lat_es = np.deg2rad(ground_params['lat_deg'])
        self.theta_min_deg = ground_params['min_elevation_deg']
        self.theta_min_rad = np.deg2rad(self.theta_min_deg)
        
        # Mean Motion for circular orbit
        self.r_orbit = self.Re + self.h
        self.n = np.sqrt(self.GM / self.r_orbit**3)
        self.period = 2 * np.pi / self.n

        # Data containers
        self.time_array = []
        self.theta_array = []
        self.contact_durations = []
        
    def run_simulation(self, days=30, step_s=5):
        """
        Propagates the satellite orbit over time to capture pass durations.
        """
        print(f"Simulating {days} days at {step_s}s intervals...")
        total_seconds = days * 24 * 3600
        t = np.arange(0, total_seconds, step_s)
        
        # Orbit Propagation
        J2 = 1.08263e-3
        raan_rate = -1.5 * self.n * J2 * (self.Re/self.r_orbit)**2 * np.cos(self.inc)
        
        M = self.n * t
        Omega = raan_rate * t
        
        # Earth Rotation
        we = 7.292115e-5
        Omega_eff = Omega - we * t
        
        # Satellite Position
        # Randomize start longitude for validity
        start_lon = np.random.uniform(0, 2*np.pi)
        
        # Sat Vector (Normalized)
        sat_vec_x = np.cos(Omega_eff + start_lon) * np.cos(M) - \
                    np.sin(Omega_eff + start_lon) * np.sin(M) * np.cos(self.inc)
        sat_vec_y = np.sin(Omega_eff + start_lon) * np.cos(M) + \
                    np.cos(Omega_eff + start_lon) * np.sin(M) * np.cos(self.inc)
        sat_vec_z = np.sin(self.inc) * np.sin(M)
        
        # ES Vector
        es_x = np.cos(self.lat_es)
        es_y = 0
        es_z = np.sin(self.lat_es)
        
        # Dot product
        cos_gamma = sat_vec_x*es_x + sat_vec_y*es_y + sat_vec_z*es_z
        
        # Elevation Angle Calculation
        d = np.sqrt(self.Re**2 + self.r_orbit**2 - 2*self.Re*self.r_orbit*cos_gamma)
        sin_theta = (self.r_orbit * cos_gamma - self.Re) / d
        theta_rad = np.arcsin(np.clip(sin_theta, -1, 1))
        
        self.theta_array = theta_rad
        
        # Duration Extraction
        is_visible = self.theta_array >= self.theta_min_rad
        edges = np.diff(is_visible.astype(int))
        starts = np.where(edges == 1)[0]
        ends = np.where(edges == -1)[0]
        
        if len(starts) == 0 or len(ends) == 0:
            self.contact_durations = []
            return
            
        if ends[0] < starts[0]: ends = ends[1:]
        if starts[-1] > ends[-1]: starts = starts[:-1]
        
        durations_steps = ends - starts
        self.contact_durations = durations_steps * step_s
        self.valid_theta_deg = np.degrees(self.theta_array[is_visible])

    def plot_analysis(self):
        if len(self.valid_theta_deg) == 0:
            print("No contacts found.")
            return

        fig, axes = plt.subplots(2, 2, figsize=(15, 10))
        plt.subplots_adjust(hspace=0.3)

        # Plot 1: Gamma PDF
        ax1 = axes[0, 0]
        ax1.hist(self.valid_theta_deg, bins=50, density=True, alpha=0.5, color='gray', label='Empirical Data')
        fit_alpha, fit_loc, fit_beta = stats.gamma.fit(self.valid_theta_deg)
        x = np.linspace(self.theta_min_deg, 90, 200)
        pdf = stats.gamma.pdf(x, fit_alpha, fit_loc, fit_beta)
        ax1.plot(x, pdf, 'r-', linewidth=2, label=f'Gamma Fit\n(a={fit_alpha:.2f}, b={fit_beta:.2f})')
        ax1.set_title("Elevation Angle PDF")
        ax1.set_xlabel("Elevation (deg)")
        ax1.legend()
        ax1.grid(True, alpha=0.3)

        # Plot 2: Contact Duration Histogram
        ax2 = axes[0, 1]
        mean_dur = np.mean(self.contact_durations)
        ax2.hist(self.contact_durations, bins=30, color='teal', edgecolor='black', alpha=0.7)
        ax2.axvline(mean_dur, color='red', linestyle='--', linewidth=2, label=f'Mean: {mean_dur:.1f}s')
        ax2.set_title("Contact Duration Histogram")
        ax2.set_xlabel("Duration (seconds)")
        ax2.set_ylabel("Frequency")
        ax2.legend()
        ax2.grid(True, alpha=0.3)
        
        # Plot 3: CDF Comparison
        ax3 = axes[1, 0]
        sorted_data = np.sort(self.valid_theta_deg)
        y_emp = np.arange(1, len(sorted_data)+1) / len(sorted_data)
        ax3.plot(sorted_data, y_emp, 'b-', label='Empirical CDF')
        y_gamma = stats.gamma.cdf(sorted_data, fit_alpha, fit_loc, fit_beta)
        ax3.plot(sorted_data, y_gamma, 'r--', label='Gamma Fit CDF')
        ax3.set_title("Cumulative Distribution Function (CDF)")
        ax3.set_xlabel("Elevation (deg)")
        ax3.set_ylabel("Probability")
        ax3.legend()
        ax3.grid(True, alpha=0.3)

        # Plot 4: Absolute Error Plot
        ax4 = axes[1, 1]
        absolute_error = np.abs(y_emp - y_gamma)
        ax4.plot(sorted_data, absolute_error, 'k-', linewidth=1.5)
        ax4.fill_between(sorted_data, absolute_error, color='gray', alpha=0.2)
        
        max_err_idx = np.argmax(absolute_error)
        max_err_val = absolute_error[max_err_idx]
        max_err_theta = sorted_data[max_err_idx]
        
        ax4.annotate(f'Max Error: {max_err_val:.3f}', 
                     xy=(max_err_theta, max_err_val), 
                     xytext=(max_err_theta+10, max_err_val+0.01),
                     arrowprops=dict(facecolor='black', shrink=0.05))
        
        ax4.set_title("Absolute Error (|Empirical - Gamma|)")
        ax4.set_xlabel("Elevation (deg)")
        ax4.set_ylabel("Absolute Error")
        ax4.grid(True, alpha=0.3)
        
        plt.show()
        return mean_dur, max_err_val

# ==========================================
# UNIFIED EXECUTION BLOCK
# ==========================================

# 1. Global Configuration
orbit_config = {
    'altitude_km': 1000,       # LEO Altitude
    'inclination_deg': 50      # Orbit Inclination
}

ground_config = {
    'lat_deg': 40.71,          # User Latitude (e.g., New York)
    'min_elevation_deg': 10    # Mask angle
}

link_config = {
    'frequency_ghz': 20.0,     # Ka-band
    'eirp_dbw': 56.0,          # Transmitter Power
    'rx_gain_dbi': 40.0,       # Receiver Gain
    'required_power_dbw': -105.0 # Sensitivity Threshold
}

# 2. Run Spatial Analysis (Link Budget)
print("\n--- [1] Running Spatial Link Budget Analysis ---")
link_sim = LeoLinkBudget(orbit_config, ground_config, link_config)
metrics = link_sim.analyze()

print(f"1. Traditional (Worst Case):")
print(f"   Min Power:      {metrics['worst_case_pr']:.2f} dBW")
print(f"   Min Margin:     {metrics['link_margin_worst']:.2f} dB")
print(f"2. Statistical (Proposed):")
print(f"   Expected Power: {metrics['expected_pr']:.2f} dBW")
print(f"   Expected Margin:{metrics['link_margin_expected']:.2f} dB")

# 3. Run Time-Series Analysis (Duration & Errors)
print("\n--- [2] Running Time-Series Duration Analysis ---")
time_sim = LeoTimeSeriesAnalysis(orbit_config, ground_config)
time_sim.run_simulation(days=60, step_s=10)
mean_dur, max_err = time_sim.plot_analysis()

print(f"Mean Contact Duration: {mean_dur:.2f} seconds")
print(f"Max Absolute CDF Error: {max_err:.4f}")

# 4. Show Spatial Plots
link_sim.plot_results()