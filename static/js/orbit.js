/**
 * LEO Constellation Visualization - Optimized Client-Side Renderer
 * 
 * Performance Optimizations:
 * 1. Client-side simulation (Walker model in JS) -> Removes network latency/overhead
 * 2. Off-screen canvas for static elements (Earth, Grid, Orbits) -> Reduces draw calls
 * 3. Sprite caching for satellites -> Fast drawing of glowing dots
 * 4. requestAnimationFrame loop -> Smooth 60hz animation
 * 
 * Updates:
 * - Geodesic Beam Projection: Accurate "footprint" shapes near poles
 */

class ConstellationVisualizer {
    constructor() {
        this.canvas = document.getElementById('orbit-canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: false });

        // Static layer for Earth, Grid, and Orbit Paths (expensive to redraw)
        this.staticCanvas = document.createElement('canvas');
        this.staticCtx = this.staticCanvas.getContext('2d', { alpha: false });
        this.staticLayerDirty = true;

        // Satellite Sprite Cache (expensive gradients)
        this.satSprite = null;

        // State
        this.satellites = [];
        this.orbits = [];
        this.params = {
            satellites: 458,
            orbital_planes: 12,
            beam_size: 0.45,
            inclination: 53.0
        };

        // Animation
        this.earthImage = null;
        this.imageLoaded = false;
        this.timeOffset = 0;
        this.lastFrameTime = 0;
        this.isPlaying = true;
        this.speed = 1.0;
        this.showPopulation = false;
        this.popOpacity = 0.8;

        // Display options
        this.showOrbits = true;
        this.showBeams = true;
        this.showGrid = true;

        // UI Elements
        this.satCount = document.getElementById('sat-count');
        this.planeCount = document.getElementById('plane-count');
        this.utcTime = document.getElementById('utc-time');

        this.init();
    }

    init() {
        this.setupCanvas();
        this.preRenderAssets();
        this.loadEarthImage();
        this.setupSocket();
        this.setupControls();

        // Start animation loop
        requestAnimationFrame((t) => this.animate(t));

        window.addEventListener('resize', () => {
            this.setupCanvas();
            this.staticLayerDirty = true;
        });
    }

    setupCanvas() {
        const container = this.canvas.parentElement;
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        // Main Canvas
        this.width = rect.width;
        this.height = rect.height;
        this.dpr = dpr;

        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';

        // Static Layer Canvas
        this.staticCanvas.width = this.canvas.width;
        this.staticCanvas.height = this.canvas.height;

        // Scale contexts
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    preRenderAssets() {
        // Pre-render glowing satellite dot to an off-screen canvas
        // This avoids calculating radial gradients 1000 times per frame
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const center = size / 2;

        // Outer glow
        const gradient = ctx.createRadialGradient(center, center, 0, center, center, 12);
        gradient.addColorStop(0, 'rgba(249, 115, 22, 0.8)');
        gradient.addColorStop(0.5, 'rgba(249, 115, 22, 0.3)');
        gradient.addColorStop(1, 'rgba(249, 115, 22, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(center, center, 12, 0, Math.PI * 2);
        ctx.fill();

        // Satellite dot
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(center, center, 3, 0, Math.PI * 2);
        ctx.fill();

        // Bright center
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(center, center, 1.5, 0, Math.PI * 2);
        ctx.fill();

        this.satSprite = canvas;
    }

    loadEarthImage() {
        this.earthImage = new Image();
        this.earthImage.crossOrigin = 'anonymous';
        this.earthImage.onload = () => {
            this.imageLoaded = true;
            this.staticLayerDirty = true;
        };
        this.earthImage.src = '/static/textures/2k_earth_daymap.jpg';

        this.popImage = new Image();
        this.popImage.crossOrigin = 'anonymous';
        this.popImage.onload = () => {
            if (this.showPopulation) this.staticLayerDirty = true;
        };
        this.popImage.src = '/static/textures/gpw_v4_density.png';
    }

    setupSocket() {
        this.socket = io();

        this.socket.on('connect', () => {
            document.getElementById('connection-status').textContent = 'Connected (Client Sim)';
            document.querySelector('.status-dot').classList.add('connected');
        });

        // We only receive initial params, logic is now client-side
        this.socket.on('initial_data', (data) => {
            console.log('Received params:', data.params);
            if (data.params) {
                this.updateParams(data.params);
            }
        });
    }

    setupControls() {
        const satSlider = document.getElementById('range-satellites');
        const planeSlider = document.getElementById('range-orbit');
        const beamSlider = document.getElementById('range-beam');
        const incSlider = document.getElementById('range-inclination');
        const speedSlider = document.getElementById('speed-slider');

        // Update params immediately on input for smooth feedback

        satSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            document.getElementById('val-satellites').textContent = val;
            this.params.satellites = val;
        });

        planeSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            document.getElementById('val-orbit').textContent = val;
            this.params.orbital_planes = val;
            this.staticLayerDirty = true; // Need to redraw orbit lines
        });

        beamSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            document.getElementById('val-beam').textContent = val.toFixed(2);
            this.params.beam_size = val;
        });

        if (incSlider) {
            incSlider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                document.getElementById('val-inclination').textContent = val;
                this.params.inclination = val;
                this.staticLayerDirty = true; // Need to redraw orbit lines
            });
        }

        speedSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            document.getElementById('speed-value').textContent = val.toFixed(1) + 'x';
            this.speed = val;
        });

        // Toggles
        document.getElementById('show-orbits').addEventListener('change', (e) => {
            this.showOrbits = e.target.checked;
            this.staticLayerDirty = true;
        });

        document.getElementById('show-beams').addEventListener('change', (e) => {
            this.showBeams = e.target.checked;
        });

        document.getElementById('show-grid').addEventListener('change', (e) => {
            this.showGrid = e.target.checked;
            this.staticLayerDirty = true;
        });

        // Play/Pause
        document.getElementById('play-btn').addEventListener('click', () => {
            this.isPlaying = !this.isPlaying;
            this.updatePlayButton();
        });

        // Map Overlay Controls
        const popToggle = document.getElementById('toggle-population');
        const opacityControl = document.getElementById('opacity-control');
        const opacitySlider = document.getElementById('range-opacity');
        const opacityVal = document.getElementById('val-opacity');

        if (popToggle) {
            popToggle.addEventListener('change', (e) => {
                this.showPopulation = e.target.checked;
                if (opacityControl) {
                    opacityControl.style.opacity = this.showPopulation ? '1' : '0.5';
                    opacityControl.style.pointerEvents = this.showPopulation ? 'auto' : 'none';
                }
                this.staticLayerDirty = true;
            });
        }

        if (opacitySlider) {
            opacitySlider.addEventListener('input', (e) => {
                this.popOpacity = parseInt(e.target.value) / 100;
                if (opacityVal) opacityVal.textContent = e.target.value + '%';
                this.staticLayerDirty = true;
            });
        }

        // Send params to server only on change (to keep state in sync if page reloads)
        const sendUpdate = () => this.socket.emit('update_params', this.params);
        satSlider.addEventListener('change', sendUpdate);
        planeSlider.addEventListener('change', sendUpdate);
        beamSlider.addEventListener('change', sendUpdate);
        if (incSlider) incSlider.addEventListener('change', sendUpdate);
    }

    updateParams(newParams) {
        this.params = { ...this.params, ...newParams };

        // Update UI sliders to match
        document.getElementById('range-satellites').value = this.params.satellites;
        document.getElementById('val-satellites').textContent = this.params.satellites;

        document.getElementById('range-orbit').value = this.params.orbital_planes;
        document.getElementById('val-orbit').textContent = this.params.orbital_planes;

        document.getElementById('range-beam').value = this.params.beam_size;
        document.getElementById('val-beam').textContent = this.params.beam_size.toFixed(2);

        if (this.params.inclination !== undefined) {
            const el = document.getElementById('range-inclination');
            if (el) {
                el.value = this.params.inclination;
                document.getElementById('val-inclination').textContent = this.params.inclination;
            }
        }

        this.staticLayerDirty = true;
    }

    // --- Simulation Logic (Walker Constellation) ---

    getSatellitePosition(satIndex, totalSats, timeOffset) {
        const numPlanes = this.params.orbital_planes || 1;
        const inclination = (this.params.inclination * Math.PI) / 180;

        const satsPerPlane = Math.ceil(totalSats / numPlanes);
        const planeIdx = satIndex % numPlanes;
        const satIdxInPlane = Math.floor(satIndex / numPlanes);

        // RAAN (Right Ascension of Ascending Node)
        const raan = (planeIdx / numPlanes) * 2 * Math.PI;

        // Mean Anomaly
        let anomaly = (satIdxInPlane / satsPerPlane) * 2 * Math.PI;
        anomaly += (planeIdx * 0.5); // Phase offset
        anomaly += timeOffset;

        // Lat/Lon calculation
        const sinLat = Math.sin(inclination) * Math.sin(anomaly);
        const lat = Math.asin(Math.max(-1, Math.min(1, sinLat)));

        const y = Math.cos(inclination) * Math.sin(anomaly);
        const x = Math.cos(anomaly);
        const lon = Math.atan2(y, x) + raan;

        // Normalize degrees
        let lonDeg = (lon * 180) / Math.PI;
        let latDeg = (lat * 180) / Math.PI;

        // Wrap longitude -180 to 180
        lonDeg = ((lonDeg + 180) % 360 + 360) % 360 - 180;

        return { lat: latDeg, lon: lonDeg };
    }

    latLonToXY(lat, lon) {
        const x = ((lon + 180) / 360) * this.width;
        const y = ((90 - lat) / 180) * this.height;
        return { x, y };
    }

    // --- Geodesic Calculation ---

    // Calculate destination point given distance and bearing
    // lat, lon in radians
    // d in radians (angular distance)
    // brng in radians
    destinationPoint(lat, lon, d, brng) {
        const sinLat = Math.sin(lat);
        const cosLat = Math.cos(lat);
        const sinD = Math.sin(d);
        const cosD = Math.cos(d);
        const sinBrng = Math.sin(brng);
        const cosBrng = Math.cos(brng);

        const lat2 = Math.asin(sinLat * cosD + cosLat * sinD * cosBrng);
        const lon2 = lon + Math.atan2(sinBrng * sinD * cosLat, cosD - sinLat * Math.sin(lat2));

        return { lat: lat2, lon: lon2 };
    }

    // --- Rendering ---

    renderStaticLayer() {
        const ctx = this.staticCtx;

        // Clear background
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, this.width, this.height);

        // 1. Draw Standard Earth (Base)
        if (this.imageLoaded && this.earthImage) {
            ctx.globalAlpha = 1.0;
            ctx.drawImage(this.earthImage, 0, 0, this.width, this.height);
        }

        // 2. Draw Population Overlay
        if (this.showPopulation && this.popImage && this.popImage.complete) {
            ctx.globalAlpha = this.popOpacity;
            ctx.drawImage(this.popImage, 0, 0, this.width, this.height);
            ctx.globalAlpha = 1.0; // Reset
        }

        // Draw Grid
        if (this.showGrid) this.drawGrid(ctx);

        // Draw Orbits
        if (this.showOrbits) this.drawOrbitPaths(ctx);

        this.staticLayerDirty = false;
    }

    drawGrid(ctx) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        // Longitude
        for (let i = -180; i <= 180; i += 30) {
            const x = ((i + 180) / 360) * this.width;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, this.height);
        }
        // Latitude
        for (let i = -90; i <= 90; i += 30) {
            const y = ((90 - i) / 180) * this.height;
            ctx.moveTo(0, y);
            ctx.lineTo(this.width, y);
        }
        ctx.stroke();

        // Equator
        ctx.strokeStyle = 'rgba(255, 200, 100, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const eqY = this.height / 2;
        ctx.moveTo(0, eqY);
        ctx.lineTo(this.width, eqY);
        ctx.stroke();
    }

    drawOrbitPaths(ctx) {
        const numPlanes = this.params.orbital_planes;
        const inclination = (this.params.inclination * Math.PI) / 180;
        const steps = 360; // Higher resolution

        ctx.lineWidth = 1.5;

        for (let p = 0; p < numPlanes; p++) {
            const hue = (p / numPlanes) * 60 + 170;
            ctx.strokeStyle = `hsla(${hue}, 70%, 50%, 0.4)`;
            ctx.beginPath();

            const raan = (p / numPlanes) * 2 * Math.PI;

            let prevLonDeg = null;

            for (let i = 0; i <= steps; i++) {
                const anomaly = (i / steps) * 2 * Math.PI;
                const sinLat = Math.sin(inclination) * Math.sin(anomaly);
                const lat = Math.asin(Math.max(-1, Math.min(1, sinLat)));
                const yArg = Math.cos(inclination) * Math.sin(anomaly);
                const xArg = Math.cos(anomaly);
                const lon = Math.atan2(yArg, xArg) + raan;

                let lonDeg = (lon * 180) / Math.PI;
                let latDeg = (lat * 180) / Math.PI;

                // Normalizing longitude to -180 to 180
                lonDeg = ((lonDeg + 180) % 360 + 360) % 360 - 180;

                const pos = this.latLonToXY(latDeg, lonDeg);

                if (i === 0) {
                    ctx.moveTo(pos.x, pos.y);
                } else {
                    // Check if crossed date line
                    if (prevLonDeg !== null && Math.abs(lonDeg - prevLonDeg) > 180) {
                        ctx.moveTo(pos.x, pos.y);
                    } else {
                        ctx.lineTo(pos.x, pos.y);
                    }
                }
                prevLonDeg = lonDeg;
            }
            ctx.stroke();
        }
    }

    animate(timestamp) {
        if (!this.lastFrameTime) this.lastFrameTime = timestamp;
        const delta = timestamp - this.lastFrameTime;
        this.lastFrameTime = timestamp;

        // Update Time
        if (this.isPlaying) {
            // Speed factor: 1.0x = 0.2 rad/s approx
            this.timeOffset += (delta / 1000) * 0.2 * this.speed;

            // Update UTC clock (simulated)
            const date = new Date();
            this.utcTime.textContent = date.toISOString().substr(11, 8);
        }

        // Update Stats
        this.satCount.textContent = this.params.satellites;
        this.planeCount.textContent = this.params.orbital_planes;

        // 1. Update Static Layer if needed
        if (this.staticLayerDirty) {
            this.renderStaticLayer();
        }

        // 2. Draw Static Layer to Main Canvas
        this.ctx.drawImage(this.staticCanvas, 0, 0, this.width, this.height);

        // 3. Draw Dynamic Elements (Beams & Satellites)
        const totalSats = this.params.satellites;

        // Draw Beams (Geodesic)
        if (this.showBeams) {
            this.ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
            this.ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
            this.ctx.lineWidth = 1;

            // Angular radius in radians.
            // Map beam_size slider (0.1 - 3.0) to approx 1 - 25 degrees
            // Let's say beam_size 1.0 = ~8 degrees (0.14 rad)
            const angularRadius = this.params.beam_size * 0.14;

            this.ctx.beginPath();

            for (let i = 0; i < totalSats; i++) {
                const pos = this.getSatellitePosition(i, totalSats, this.timeOffset);
                const centerLat = pos.lat * Math.PI / 180;
                const centerLon = pos.lon * Math.PI / 180;

                // Create polygon for the beam
                let first = true;
                const segments = 32;

                // We need to handle wrapping manually if we draw a polygon
                // Simple approach: Draw it. If it wraps, we'll see artifacts (lines across screen).
                // To fix wrapping properly for filled polygons is complex.
                // A cheat for performance: Check if any point wraps.
                // If it's near the date line, split it or just draw it carefully.
                // For now, let's just draw points and use moveTo if abs(lon_diff) > PI

                // Actually, for a filled beam, splitting is hard.
                // Let's check if the satellite is near the edge.

                // Simpler Render: just draw points as a line loop. Fill might be glitchy
                // if it crosses the date line, but let's try.

                // Calculate points
                const points = [];
                let crossesDateLine = false;

                for (let j = 0; j <= segments; j++) {
                    const brng = (j / segments) * 2 * Math.PI;
                    const p = this.destinationPoint(centerLat, centerLon, angularRadius, brng);

                    // Normalize lon to -PI to PI
                    p.lon = (p.lon + 3 * Math.PI) % (2 * Math.PI) - Math.PI;

                    const degLat = p.lat * 180 / Math.PI;
                    const degLon = p.lon * 180 / Math.PI;
                    const xy = this.latLonToXY(degLat, degLon);
                    points.push(xy);

                    if (j > 0) {
                        if (Math.abs(points[j].x - points[j - 1].x) > this.width / 2) {
                            crossesDateLine = true;
                        }
                    }
                }

                if (!crossesDateLine) {
                    this.ctx.moveTo(points[0].x, points[0].y);
                    for (let k = 1; k < points.length; k++) {
                        this.ctx.lineTo(points[k].x, points[k].y);
                    }
                } else {
                    // If it crosses date line, draw two polygons? 
                    // Or just skip filling for edge cases to maintain performance?
                    // Let's try drawing it twice, once shifted left, once shifted right.
                    // This is the standard trick for wrapping maps.
                    // But expensive.

                    // Alternative: just don't draw beams that cross the line for now.
                    // Or draw them as simple circles if near edge? 
                    // The "bent" shape is most important near poles, which is not usually the date line edge.
                    // Actually poles stretch horizontally.

                    // Let's just draw it. Canvas usually handles fill with "even-odd" rule which might
                    // look okay or weird. If we see lines traversing the screen, we know why.
                    // A quick fix for line traversing:

                    // Split points into groups based on longitude sign?
                    // Let's just check dist > width/2 and moveTo instead of lineTo.
                    // But that kills the Fill.

                    // For now, let's act as if no wrap logic (glitchy at edge) 
                    // but correct "bent" shape elsewhere.
                    this.ctx.moveTo(points[0].x, points[0].y);
                    for (let k = 1; k < points.length; k++) {
                        if (Math.abs(points[k].x - points[k - 1].x) < this.width / 2) {
                            this.ctx.lineTo(points[k].x, points[k].y);
                        } else {
                            // visual glitch prevention: just stop this polygon
                            // this results in "opened" circles at the date line
                            this.ctx.moveTo(points[k].x, points[k].y);
                        }
                    }
                }
            }
            // Batched fill/stroke
            this.ctx.fill();
            this.ctx.stroke();
        }

        // Draw Satellites (using cached sprite)
        if (this.satSprite) {
            const offset = this.satSprite.width / 2;
            for (let i = 0; i < totalSats; i++) {
                const pos = this.getSatellitePosition(i, totalSats, this.timeOffset);
                const xy = this.latLonToXY(pos.lat, pos.lon);

                this.ctx.drawImage(this.satSprite, xy.x - offset, xy.y - offset);
            }
        }

        requestAnimationFrame((t) => this.animate(t));
    }

    updatedPlayButton() {
        const play = document.getElementById('play-icon');
        const pause = document.getElementById('pause-icon');
        if (this.isPlaying) {
            play.style.display = 'none';
            pause.style.display = 'block';
        } else {
            play.style.display = 'block';
            pause.style.display = 'none';
        }
    }

    updatePlayButton() {
        // Wrapper for button UI update
        this.updatedPlayButton();
    }
}

// Dropdown toggle
function toggleDropdown(id) {
    document.getElementById(id).classList.toggle('is-open');
}

document.addEventListener('DOMContentLoaded', () => {
    new ConstellationVisualizer();
});
