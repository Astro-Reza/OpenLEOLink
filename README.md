# OpenLEOLink (LEO Analyzer)

A comprehensive web-based platform for Low Earth Orbit (LEO) satellite constellation visualization and link budget analysis.

## Features

### 1. 2D Orbit Visualization
*   **Real-time Animation**: Dynamic satellite constellation orbits projected onto a world map.
*   **Interactive Controls**: Toggle between global coverage and specific ground station analysis.

### 2. 3D Pass Analysis (Sky Dome)
*   **Heatmap Visualization**: Sky Dome colored by elevation using custom GLSL shaders (Red at horizon, Blue at zenith).
*   **Pass Trajectories**: Visualizes Shortest, Median, and Longest orbital passes for any given ground station.
*   **Directional Labels**: N, S, E, W, and Zenith markers for intuitive sky orientation.
*   **Satellite Demo**: Animated white-dot satellite simulating actual pass behavior along path lines.

### 3. Advanced Link Budget Calculator
*   **Monte Carlo Simulation**: High-performance client-side simulation (30,000+ samples) for robust statistical analysis.
*   **Hardware Analysis**: Support for EIRP, G/R, Frequency, and Atmospheric attenuation modeling.
*   **Statistical Metrics**: Calculates Worst-case, Expected, and Best-case received power (Pr) and Link Margins.

### 4. Time-Series & Statistical Analysis
*   **Long-term Simulation**: 60-day mission modeling at high-resolution (10s intervals).
*   **Contact Histograms**: Detailed distribution analysis of satellite pass durations.
*   **Gamma Distribution Fitting**: Automatic fitting of elevation probability density functions (PDF).
*   **CDF Verification**: Comparison between empirical mission data and theoretical Gamma-fit CDFs.

### 5. Premium Palatine UX
*   **Modern Aesthetics**: HSL-tailored colors, dark-mode glassmorphism, and slick gradient overlays.
*   **System Initialization**: Detailed loading sequences with glitch-style animations.
*   **Responsive Control Panel**: Collapsible dropdown segments for Space, Ground, and Hardware specs.

## Tech Stack
*   **Backend**: Flask (Python) - optimized for Vercel Serverless deployment.
*   **3D Engine**: Three.js (WebGL).
*   **Charts**: Chart.js.
*   **Simulation**: Vanilla JavaScript with TypedArrays for high-speed client-side math.

## Installation & Setup

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/Astro-Reza/OpenLEOLink.git
    cd OpenLEOLink
    ```
2.  **Install dependencies**:
    ```bash
    pip install -r requirements.txt
    ```
3.  **Run locally**:
    ```bash
    python app.py
    ```
4.  **Access the Dashboard**: Open `http://localhost:5000` set to the `terminal` route.

## Deployment
The repository includes a `vercel.json` configuration for immediate deployment on the **Vercel** platform, utilizing its serverless Python environment and static asset optimization.

---
© 2026 **Palatine Technologies**. Developed for the NASA Space Apps Challenge Jakarta.
