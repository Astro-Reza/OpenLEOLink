import numpy as np
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors

def plot_sky_dome_heatmap(link_budget_sim):
    """
    Creates a 'Beam Graph' (Polar Heatmap) with inverted colors:
    Blue = Best Signal (Zenith), Red = Worst Signal (Horizon).
    """
    # 1. Generate Angles (0 to 180 degrees)
    plot_angles_deg = np.linspace(0, 180, 200)
    
    # Convert Plot Angle to Physical Elevation Angle
    elevation_deg = 90 - np.abs(plot_angles_deg - 90)
    
    # Clip to min_elevation
    min_el = np.degrees(link_budget_sim.theta_min)
    mask = elevation_deg >= min_el
    
    # 2. Calculate Power
    valid_elevations = np.radians(elevation_deg[mask])
    
    # Calculate Slant Range
    Re = link_budget_sim.Re
    h = link_budget_sim.h
    term1 = -Re * np.sin(valid_elevations)
    term2 = np.sqrt((Re * np.sin(valid_elevations))**2 + h**2 + 2*Re*h)
    slant_ranges = term1 + term2
    
    # Calculate Power
    attenuation = link_budget_sim._calculate_attenuation(valid_elevations, slant_ranges)
    power_values = link_budget_sim.eirp_dbw + link_budget_sim.gr_dbi - attenuation - link_budget_sim.sys_loss_db
    
    # 3. Setup the Polar Plot
    fig = plt.figure(figsize=(10, 6))
    ax = fig.add_subplot(111, projection='polar')
    
    ax.set_thetamin(0)
    ax.set_thetamax(180)
    ax.set_theta_zero_location("W")
    ax.set_theta_direction(-1)
    
    # 4. Create the Heatmap (Red-Yellow-Blue)
    # RdYlBu maps Low values (Worst) to Red and High values (Best) to Blue
    norm = mcolors.Normalize(vmin=np.min(power_values), vmax=np.max(power_values))
    cmap = plt.get_cmap('RdYlBu') 
    
    # Plot bars
    bars = ax.bar(np.radians(plot_angles_deg[mask]), 
                  height=1.0, 
                  width=np.radians(180/200), 
                  color=cmap(norm(power_values)), 
                  edgecolor='none',
                  align='edge')
    
    # 5. Styling
    ax.set_yticks([])
    ax.set_xticks(np.radians([0, 45, 90, 135, 180]))
    ax.set_xticklabels(['Horizon\n(Worst)', '', 'Zenith\n(Best)', '', 'Horizon\n(Worst)'], 
                       fontsize=10, fontweight='bold')
    
    # Add Colorbar
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    cbar = plt.colorbar(sm, ax=ax, orientation='horizontal', pad=0.15, aspect=40)
    cbar.set_label('Received Signal Power (dBW) | Blue = Strong, Red = Weak', fontsize=12, fontweight='bold')
    
    plt.title(f"Connection Quality Heatmap", fontsize=14, pad=20)
    
    plt.show()

# --- RUN ---
plot_sky_dome_heatmap(link_sim)