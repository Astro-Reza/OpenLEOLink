import numpy as np
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D
import matplotlib.cm as cm

# --- REUSE THE SIMULATOR CLASS FROM BEFORE ---
# (We assume 'LeoTrackSimulator' is defined as in the previous step)
# If not, paste the class definition here.

def plot_3d_dome_tracks(passes):
    """
    Plots a 3D Hemisphere (Horizontal Coordinate System) with satellite tracks.
    """
    fig = plt.figure(figsize=(12, 10))
    ax = fig.add_subplot(111, projection='3d')
    
    # 1. CREATE THE DOME (THE HEATMAP)
    # Azimuth: 0 to 360, Elevation: 0 to 90
    az_mesh = np.linspace(0, 2*np.pi, 100)
    el_mesh = np.linspace(0, np.pi/2, 50)
    AZ, EL = np.meshgrid(az_mesh, el_mesh)
    
    # Convert Spherical to Cartesian (Radius = 1.0)
    # Using convention: Y=North, X=East, Z=Up
    # x = cos(el) * sin(az)
    # y = cos(el) * cos(az)
    # z = sin(el)
    
    X_dome = np.cos(EL) * np.sin(AZ)
    Y_dome = np.cos(EL) * np.cos(AZ)
    Z_dome = np.sin(EL)
    
    # Color mapping: Z height determines color (Elevation)
    # Normalize Z (0 to 1) -> RdYlBu colormap
    norm_z = Z_dome  # Since Z goes 0 to 1
    colors = cm.RdYlBu(norm_z)
    
    # Plot the surface
    # alpha=0.3 makes it transparent so we can see tracks on the other side
    surf = ax.plot_surface(X_dome, Y_dome, Z_dome, facecolors=colors, 
                           rstride=5, cstride=5, alpha=0.25, shade=False, linewidth=0)
    
    # 2. PLOT THE TRACKS
    # Sort passes to find short/med/long
    passes.sort(key=lambda x: x['dur'])
    
    if not passes:
        print("No passes to plot.")
        return

    selected_passes = [
        (passes[0], 'darkred', 'Short Pass'),          # Shortest
        (passes[len(passes)//2], 'black', 'Med Pass'), # Median
        (passes[-1], 'blue', 'Long Pass')              # Longest
    ]
    
    for p_data, color, label in selected_passes:
        az_rad = np.radians(p_data['az'])
        el_rad = np.radians(p_data['el'])
        
        # Convert track to Cartesian 3D
        # Add a tiny bit to radius (1.01) so lines float slightly above the dome surface
        r_line = 1.01 
        x_line = r_line * np.cos(el_rad) * np.sin(az_rad)
        y_line = r_line * np.cos(el_rad) * np.cos(az_rad)
        z_line = r_line * np.sin(el_rad)
        
        ax.plot(x_line, y_line, z_line, color=color, linewidth=3, label=f"{label} ({int(p_data['dur'])}s)")
        
        # Add Start/End markers
        ax.scatter(x_line[0], y_line[0], z_line[0], color=color, marker='^', s=50) # Rise
        ax.scatter(x_line[-1], y_line[-1], z_line[-1], color=color, marker='x', s=50) # Set

    # 3. DRAW CONTEXT (GROUND & DIRECTIONS)
    # Draw "Compass" lines on the floor
    ax.plot([-1, 1], [0, 0], [0, 0], 'k--', linewidth=1, alpha=0.5) # West-East
    ax.plot([0, 0], [-1, 1], [0, 0], 'k--', linewidth=1, alpha=0.5) # South-North
    
    # Add Direction Labels
    ax.text(0, 1.1, 0, "N", fontsize=14, fontweight='bold', color='black')
    ax.text(0, -1.1, 0, "S", fontsize=12, color='black')
    ax.text(1.1, 0, 0, "E", fontsize=12, color='black')
    ax.text(-1.1, 0, 0, "W", fontsize=12, color='black')
    ax.text(0, 0, 1.1, "Zenith", fontsize=12, color='blue')

    # 4. VIEW SETTINGS
    ax.set_box_aspect([1, 1, 0.5]) # Make Z axis shorter visually (looks more like a dome)
    ax.set_axis_off() # Hide the ugly box frame
    
    # Set initial camera angle (Elevation 30 deg, Azimuth -60 deg)
    ax.view_init(elev=30, azim=-60)
    
    plt.title("3D Horizontal Coordinate System\n(Satellite Tracks on Sky Dome)", fontsize=15)
    plt.legend(loc='lower right')
    plt.show()

# --- RUN IT ---
# 1. Setup Simulator (Reusing previous classes/configs)
orbit_conf = {'altitude_km': 1000, 'inclination_deg': 50}
ground_conf = {'lat_deg': 40.71, 'min_elevation_deg': 10}

sim = LeoTrackSimulator(orbit_conf, ground_conf)
pass_list = sim.simulate_passes(days=2) # 2 days is enough for a clean plot

# 2. Plot 3D
plot_3d_dome_tracks(pass_list)