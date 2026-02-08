/**
 * LEO Constellation Visualization - Optimized Client-Side Renderer
 * Supports both 2D (Canvas) and 3D (Three.js) modes.
 */

class ConstellationVisualizer {
    constructor() {
        this.canvas2D = document.getElementById('orbit-canvas');
        this.container3D = document.getElementById('orbit-container-3d');
        this.ctx = this.canvas2D.getContext('2d', { alpha: false });

        this.loaderScreen = document.getElementById('loader-screen');
        this.appContainer = document.getElementById('app-container');

        // Mode: '2D' or '3D'
        this.mode = '2D';

        // --- 2D Assets ---
        this.staticCanvas = document.createElement('canvas');
        this.staticCtx = this.staticCanvas.getContext('2d', { alpha: false });
        this.staticLayerDirty = true;
        this.satSprite = null;

        // --- 3D Assets ---
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.earthMesh = null;
        this.densityMesh3D = null; // Population Density Sphere
        this.beamMesh = null; // THREE.InstancedMesh for beams
        this.satPoints = null; // THREE.Points
        this.orbitLines = [];  // Array of THREE.Line
        this.earthRadius = 5;
        this.orbitRadius = 5.5; // Approx altitude (Lowered for better visual)

        // Use a group for orbits to easily clear them
        this.orbitGroup = null;

        // State
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
        this.simTime = Date.now();
        this.lastFrameTime = 0;
        this.isPlaying = true;
        this.speed = 1.0;
        this.showPopulation = false;
        this.popOpacity = 0.8;

        // Display options
        this.showOrbits = true;
        this.showBeams = true;
        this.showGrid = true;

        // 2D Map Zoom/Pan state
        this.scale = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.isPanning = false;
        this.lastPanX = 0;
        this.lastPanY = 0;

        // Map dimensions (for 2:1 aspect ratio)
        this.mapWidth = 0;
        this.mapHeight = 0;
        this.mapOffsetX = 0;
        this.mapOffsetY = 0;

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
        this.initializeClientMode(); // No server needed - runs fully client-side
        this.setupControls();
        this.init3D(); // Initialize 3D scene (hidden initially)

        // Start animation loop
        requestAnimationFrame((t) => this.animate(t));

        window.addEventListener('resize', () => {
            this.setupCanvas();
            this.handleResize3D();
            this.staticLayerDirty = true;
        });

        // Zoom with mouse wheel (2D only)
        this.canvas2D.addEventListener('wheel', (e) => {
            if (this.mode !== '2D') return;
            e.preventDefault();

            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Math.max(1, Math.min(10, this.scale * zoomFactor));

            // Zoom toward mouse position
            const rect = this.canvas2D.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // Adjust pan to zoom toward mouse
            const prevScale = this.scale;
            this.scale = newScale;

            if (newScale !== prevScale) {
                const scaleChange = newScale / prevScale;
                this.panX = mouseX - (mouseX - this.panX) * scaleChange;
                this.panY = mouseY - (mouseY - this.panY) * scaleChange;
            }

            this.staticLayerDirty = true;
        }, { passive: false });

        // Pan with mouse drag (2D only)
        this.canvas2D.addEventListener('mousedown', (e) => {
            if (this.mode !== '2D') return;
            this.isPanning = true;
            this.lastPanX = e.clientX;
            this.lastPanY = e.clientY;
            this.canvas2D.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isPanning || this.mode !== '2D') return;
            const dx = e.clientX - this.lastPanX;
            const dy = e.clientY - this.lastPanY;
            this.panX += dx;
            this.panY += dy;
            this.lastPanX = e.clientX;
            this.lastPanY = e.clientY;
            this.staticLayerDirty = true;
        });

        window.addEventListener('mouseup', () => {
            this.isPanning = false;
            this.canvas2D.style.cursor = 'grab';
        });

        // Set default cursor for 2D canvas
        this.canvas2D.style.cursor = 'grab';
    }

    // --- Loading Screen Logic ---
    initLoadingScreen() {
        const TOTAL_BLOCKS = 20;
        const DURATION = 3500;
        const gridContainer = document.getElementById('progressGrid');
        const percentText = document.getElementById('percentText');
        const loaderBody = document.getElementById('loaderBody');

        // Initialize Grid
        for (let i = 0; i < TOTAL_BLOCKS; i++) {
            const block = document.createElement('div');
            block.className = 'p-block';
            gridContainer.appendChild(block);
        }

        // Start Animation Sequence
        setTimeout(() => {
            loaderBody.classList.add('is-open');
            startLoading();
        }, 800);

        const startLoading = () => {
            let startTime = null;

            const animateLoad = (timestamp) => {
                if (!startTime) startTime = timestamp;
                const progress = timestamp - startTime;
                let percent = Math.min(progress / DURATION, 1);

                let displayPercent = Math.floor(percent * 100);
                percentText.innerText = `${displayPercent}%`;

                const blocksToFill = Math.floor(percent * TOTAL_BLOCKS);
                const blocks = gridContainer.children;

                for (let i = 0; i < TOTAL_BLOCKS; i++) {
                    if (i < blocksToFill) {
                        blocks[i].classList.add('filled');
                    } else {
                        blocks[i].classList.remove('filled');
                    }
                }

                if (progress < DURATION) {
                    requestAnimationFrame(animateLoad);
                } else {
                    percentText.innerText = "100%";
                    Array.from(blocks).forEach(b => b.classList.add('filled'));

                    // Finished Loading
                    setTimeout(() => {
                        this.loaderScreen.classList.add('hidden');
                        this.appContainer.style.opacity = '1';
                    }, 500);
                }
            }
            requestAnimationFrame(animateLoad);
        }
    }

    // --- 3D Initialization ---
    init3D() {
        // Scene & Camera
        const manager = new THREE.LoadingManager();
        manager.onProgress = function (url, itemsLoaded, itemsTotal) {
            const percent = Math.floor((itemsLoaded / itemsTotal) * 100);
            const text = document.getElementById('percentText');
            if (text) text.innerText = percent + '%';
        };
        manager.onLoad = function () {
            const loader = document.getElementById('loader-screen');
            if (loader) loader.classList.add('hidden');
            const app = document.getElementById('app-container');
            if (app) app.style.opacity = '1';
        };

        // Scene & Camera
        this.scene = new THREE.Scene();

        const fov = 45;
        const aspect = this.container3D.clientWidth / this.container3D.clientHeight;
        const near = 0.1;
        const far = 2000;
        this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
        this.camera.position.set(0, 10, 20);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(this.container3D.clientWidth, this.container3D.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container3D.appendChild(this.renderer.domElement);

        // Controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 7;
        this.controls.maxDistance = 50;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        this.scene.add(ambientLight);

        // Sun Logic
        const sunDir = new THREE.Vector3(-50, 20, -50).normalize();

        // Point Light at Sun Position
        const pointLight = new THREE.PointLight(0xffffff, 1.5);
        pointLight.position.copy(sunDir).multiplyScalar(100);
        pointLight.position.copy(sunDir).multiplyScalar(800);
        this.scene.add(pointLight);
        const sunGeo = new THREE.SphereGeometry(20, 32, 32);
        const sunMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const sunMesh = new THREE.Mesh(sunGeo, sunMat);
        sunMesh.position.copy(pointLight.position);
        this.scene.add(sunMesh);
        const glowGeo1 = new THREE.SphereGeometry(25, 32, 32);
        const glowMat1 = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending
        });
        const glowMesh1 = new THREE.Mesh(glowGeo1, glowMat1);
        glowMesh1.position.copy(pointLight.position);
        this.scene.add(glowMesh1);

        // Middle glow (softer white)
        const glowGeo2 = new THREE.SphereGeometry(35, 32, 32);
        const glowMat2 = new THREE.MeshBasicMaterial({
            color: 0xffffee,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending
        });
        const glowMesh2 = new THREE.Mesh(glowGeo2, glowMat2);
        glowMesh2.position.copy(pointLight.position);
        this.scene.add(glowMesh2);

        // Outer glow (subtle corona)
        const glowGeo3 = new THREE.SphereGeometry(50, 32, 32);
        const glowMat3 = new THREE.MeshBasicMaterial({
            color: 0xffeedd,
            transparent: true,
            opacity: 0.15,
            blending: THREE.AdditiveBlending
        });
        const glowMesh3 = new THREE.Mesh(glowGeo3, glowMat3);
        glowMesh3.position.copy(pointLight.position);
        this.scene.add(glowMesh3);

        // --- Starfield Background (Milky Way) ---
        const starGeo = new THREE.SphereGeometry(1500, 64, 64);
        const textureLoader = new THREE.TextureLoader(manager); // Pass manager
        const starTex = textureLoader.load('/static/textures/8k_stars_milky_way.jpg');
        const starMat = new THREE.MeshBasicMaterial({
            map: starTex,
            side: THREE.BackSide
        });
        const starMesh = new THREE.Mesh(starGeo, starMat);
        this.scene.add(starMesh);

        // Earth
        const earthGeo = new THREE.SphereGeometry(this.earthRadius, 64, 64);

        const dayTex = textureLoader.load('/static/textures/8k_earth_daymap.jpg');
        const nightTex = textureLoader.load('/static/textures/8k_earth_nightmap.jpg');

        const earthNavMat = new THREE.ShaderMaterial({
            uniforms: {
                dayTexture: { value: dayTex },
                nightTexture: { value: nightTex },
                // Inverted Sun Direction for correct Day/Night cycle
                sunDirection: { value: new THREE.Vector3(-50, 20, -50).normalize() }
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vNormalWorld;
                void main() {
                    vUv = uv;
                    vNormalWorld = normalize(mat3(modelMatrix) * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D dayTexture;
                uniform sampler2D nightTexture;
                uniform vec3 sunDirection;

                varying vec2 vUv;
                varying vec3 vNormalWorld;

                void main() {
                    float intensity = dot(vNormalWorld, sunDirection);
                    float mixVal = smoothstep(-0.2, 0.2, intensity);
                    vec3 dayColor = texture2D(dayTexture, vUv).rgb;
                    vec3 nightColor = texture2D(nightTexture, vUv).rgb;
                    gl_FragColor = vec4(mix(nightColor, dayColor, mixVal), 1.0);
                }
            `
        });

        this.earthMesh = new THREE.Mesh(earthGeo, earthNavMat);
        this.scene.add(this.earthMesh);

        // --- Population Density Sphere ---
        const densGeo = new THREE.SphereGeometry(this.earthRadius + 0.02, 64, 64);
        const densTex = textureLoader.load('/static/textures/gpw_v4_density.png');

        const densMat = new THREE.MeshPhongMaterial({
            map: densTex,
            transparent: true,
            opacity: this.popOpacity,
            blending: THREE.NormalBlending,
            side: THREE.FrontSide,
            depthWrite: false
        });

        this.densityMesh3D = new THREE.Mesh(densGeo, densMat);
        this.densityMesh3D.visible = this.showPopulation;
        this.scene.add(this.densityMesh3D);

        // Satellites (Particle System)
        const satGeo = new THREE.BufferGeometry();
        // Initial dummy data
        const positions = new Float32Array(this.params.satellites * 3);
        satGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        // Create a simple solid dot sprite (no glow)
        const spriteSize = 16;
        const spriteCanvas = document.createElement('canvas');
        spriteCanvas.width = spriteSize;
        spriteCanvas.height = spriteSize;
        const sCtx = spriteCanvas.getContext('2d');
        const center = spriteSize / 2;

        // Simple solid white dot
        sCtx.fillStyle = '#ffffff';
        sCtx.beginPath();
        sCtx.arc(center, center, 4, 0, Math.PI * 2);
        sCtx.fill();

        const spriteTexture = new THREE.CanvasTexture(spriteCanvas);

        const satMat = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.15,
            map: spriteTexture,
            transparent: true,
            depthWrite: false
        });

        this.satPoints = new THREE.Points(satGeo, satMat);
        this.scene.add(this.satPoints);

        // Orbits Group
        this.orbitGroup = new THREE.Group();
        this.scene.add(this.orbitGroup);

        this.update3DOrbits();

        // --- Beams (InstancedMesh) ---
        const maxSats = 5000;
        const alignGeometry = new THREE.ConeGeometry(1, 1, 32, 1, true);
        alignGeometry.rotateX(-Math.PI / 2);
        alignGeometry.translate(0, 0, 0.5);

        const beamMat = new THREE.MeshBasicMaterial({
            color: 0x00ffff, // Cyan
            opacity: 0.15,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        this.beamMesh = new THREE.InstancedMesh(alignGeometry, beamMat, maxSats);
        this.beamMesh.count = this.params.satellites;
        this.beamMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.beamMesh);
    }

    handleResize3D() {
        if (!this.camera || !this.renderer) return;
        const width = this.container3D.clientWidth;
        const height = this.container3D.clientHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    setupCanvas() {
        const container = this.canvas2D.parentElement;
        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        // Main Canvas
        this.width = rect.width;
        this.height = rect.height;
        this.dpr = dpr;

        this.canvas2D.width = this.width * dpr;
        this.canvas2D.height = this.height * dpr;
        this.canvas2D.style.width = this.width + 'px';
        this.canvas2D.style.height = this.height + 'px';

        // Calculate map dimensions maintaining 2:1 aspect ratio
        const targetAspect = 2.0; // width / height = 2:1
        const containerAspect = this.width / this.height;

        if (containerAspect > targetAspect) {
            // Container is wider than 2:1, fit to height
            this.mapHeight = this.height;
            this.mapWidth = this.height * targetAspect;
        } else {
            // Container is taller than 2:1, fit to width
            this.mapWidth = this.width;
            this.mapHeight = this.width / targetAspect;
        }

        // Center the map
        this.mapOffsetX = (this.width - this.mapWidth) / 2;
        this.mapOffsetY = (this.height - this.mapHeight) / 2;

        // Static Layer Canvas
        this.staticCanvas.width = this.canvas2D.width;
        this.staticCanvas.height = this.canvas2D.height;

        // Scale contexts
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    preRenderAssets() {
        // Pre-render simple solid satellite dot (no glow)
        const size = 6;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const center = size / 2;

        // Simple solid dot
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(center, center, 2, 0, Math.PI * 2);
        ctx.fill();

        this.satSprite = canvas;
    }

    loadEarthImage() {
        this.earthImage = new Image();
        this.earthImage.crossOrigin = 'anonymous';
        this.earthImage.onload = () => {
            this.imageLoaded = true;
            this.staticLayerDirty = true; // Always redraw when Earth image loads
        };
        this.earthImage.src = '/static/textures/8k_earth_daymap.jpg';

        this.popImage = new Image();
        this.popImage.crossOrigin = 'anonymous';
        this.popImage.onload = () => {
            if (this.showPopulation) this.staticLayerDirty = true;
        };
        this.popImage.src = '/static/textures/gpw_v4_density.png';
    }

    initializeClientMode() {
        // No server connection needed - simulation runs entirely client-side
        document.getElementById('connection-status').textContent = 'Client Simulation';
        document.querySelector('.status-dot').classList.add('connected');
        console.log('LEO Constellation running in client-side mode');
    }

    setupControls() {
        const satSlider = document.getElementById('range-satellites');
        const planeSlider = document.getElementById('range-orbit');
        const beamSlider = document.getElementById('range-beam');
        const incSlider = document.getElementById('range-inclination');
        const speedSlider = document.getElementById('speed-slider');

        // Toggle Buttons
        const btn2D = document.getElementById('btn-2d');
        const btn3D = document.getElementById('btn-3d');

        btn2D.addEventListener('click', () => this.setMode('2D'));
        btn3D.addEventListener('click', () => this.setMode('3D'));

        satSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            document.getElementById('val-satellites').textContent = val;
            this.params.satellites = val;
        });

        planeSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            document.getElementById('val-orbit').textContent = val;
            this.params.orbital_planes = val;
            this.staticLayerDirty = true;
            this.update3DOrbits();
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
                this.staticLayerDirty = true;
                this.update3DOrbits();
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
            if (this.orbitGroup) this.orbitGroup.visible = this.showOrbits;
        });

        document.getElementById('show-beams').addEventListener('change', (e) => {
            this.showBeams = e.target.checked;
            if (this.beamMesh) this.beamMesh.visible = this.showBeams;
        });

        document.getElementById('show-grid').addEventListener('change', (e) => {
            this.showGrid = e.target.checked;
            this.staticLayerDirty = true;
        });

        // Play/Pause
        document.getElementById('play-btn').addEventListener('click', () => {
            this.isPlaying = !this.isPlaying;
            this.updatePlayButton();
            this.updatePlayButton();
        });

        // Reset Time
        const resetBtn = document.getElementById('reset-time-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.simTime = Date.now();
                const date = new Date(this.simTime);
                this.utcTime.textContent = date.toISOString().substr(11, 8);
            });
        }

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

                // Update 3D Vis
                if (this.densityMesh3D) {
                    this.densityMesh3D.visible = this.showPopulation;
                }
            });
        }

        if (opacitySlider) {
            opacitySlider.addEventListener('input', (e) => {
                this.popOpacity = parseInt(e.target.value) / 100;
                if (opacityVal) opacityVal.textContent = e.target.value + '%';
                this.staticLayerDirty = true;

                // Update 3D Opacity
                if (this.densityMesh3D) {
                    this.densityMesh3D.material.opacity = this.popOpacity;
                }
            });
        }

        // Send params to server only on change
        const sendUpdate = () => this.socket.emit('update_params', this.params);
        satSlider.addEventListener('change', sendUpdate);
        planeSlider.addEventListener('change', sendUpdate);
        beamSlider.addEventListener('change', sendUpdate);
        if (incSlider) incSlider.addEventListener('change', sendUpdate);
    }

    setMode(mode) {
        this.mode = mode;
        const btn2D = document.getElementById('btn-2d');
        const btn3D = document.getElementById('btn-3d');

        if (mode === '2D') {
            this.canvas2D.style.display = 'block';
            this.container3D.style.display = 'none';
            btn2D.classList.add('active');
            btn3D.classList.remove('active');
            this.handleResize3D();
        } else {
            this.canvas2D.style.display = 'none';
            this.container3D.style.display = 'block';
            btn2D.classList.remove('active');
            btn3D.classList.add('active');
            this.handleResize3D();
        }
    }

    updateParams(newParams) {
        const oldPlanes = this.params.orbital_planes;
        const oldInc = this.params.inclination;

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

        if (oldPlanes !== this.params.orbital_planes || oldInc !== this.params.inclination) {
            this.update3DOrbits();
        }
    }

    // --- Simulation Logic (Walker Constellation) ---

    getSatellitePosition(satIndex, totalSats, timeOffset) {
        const numPlanes = this.params.orbital_planes || 1;
        const inclination = (this.params.inclination * Math.PI) / 180;

        const satsPerPlane = Math.ceil(totalSats / numPlanes);
        const planeIdx = satIndex % numPlanes;
        const satIdxInPlane = Math.floor(satIndex / numPlanes);

        // RAAN
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

        return { lat: latDeg, lon: lonDeg, latRad: lat, lonRad: lon };
    }

    latLonToXY(lat, lon) {
        // Map lat/lon to the 2:1 aspect ratio map area
        const x = this.mapOffsetX + ((lon + 180) / 360) * this.mapWidth;
        const y = this.mapOffsetY + ((90 - lat) / 180) * this.mapHeight;
        return { x, y };
    }

    // Convert Lat/Lon (degrees) to 3D Vector3 on sphere surface
    latLonToVector3(lat, lon, radius) {
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lon + 180) * (Math.PI / 180);

        const x = -(radius * Math.sin(phi) * Math.cos(theta));
        const z = (radius * Math.sin(phi) * Math.sin(theta));
        const y = (radius * Math.cos(phi));
        return new THREE.Vector3(x, y, z);
    }

    // --- Geodesic Calculation for Beams ---
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

    // --- 2D Night Shadow ---
    drawNightShadow(ctx) {
        const date = new Date(this.simTime);
        const utcDecimal = date.getUTCHours() + date.getUTCMinutes() / 60;

        let sunLon = (12 - utcDecimal) * 15;
        sunLon = ((sunLon + 180) % 360 + 360) % 360 - 180;
        let nightLon = sunLon + 180;
        if (nightLon > 180) nightLon -= 360;
        let startLon = nightLon - 90;
        let endLon = nightLon + 90;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        const lonToX = (lon) => this.mapOffsetX + ((lon + 180) / 360) * this.mapWidth;
        if (startLon < -180) {
            const x1 = lonToX(startLon + 360);
            const w1 = lonToX(180) - x1;
            ctx.fillRect(x1, this.mapOffsetY, w1, this.mapHeight);

            const x2 = lonToX(-180);
            const w2 = lonToX(endLon) - x2;
            ctx.fillRect(x2, this.mapOffsetY, w2, this.mapHeight);

        } else if (endLon > 180) {
            const x1 = lonToX(startLon);
            const w1 = lonToX(180) - x1;
            ctx.fillRect(x1, this.mapOffsetY, w1, this.mapHeight);

            const x2 = lonToX(-180);
            const w2 = lonToX(endLon - 360) - x2;
            ctx.fillRect(x2, this.mapOffsetY, w2, this.mapHeight);
        } else {
            // No wrap
            const x = lonToX(startLon);
            const w = lonToX(endLon) - x;
            ctx.fillRect(x, this.mapOffsetY, w, this.mapHeight);
        }
    }

    // --- Logic for 3D Orbits ---
    update3DBeams(totalSats) {
        if (!this.beamMesh || !this.showBeams) return;

        const dummy = new THREE.Object3D();
        const earthCenter = new THREE.Vector3(0, 0, 0);

        // Update count if changed
        if (this.beamMesh.count !== totalSats) {
            this.beamMesh.count = totalSats;
        }
        const angle = this.params.beam_size * 0.5; // Tuning

        for (let i = 0; i < totalSats; i++) {
            const pos = this.getSatellitePosition(i, totalSats, this.timeOffset);
            const vec3 = this.latLonToVector3(pos.lat, pos.lon, this.orbitRadius);

            dummy.position.copy(vec3);
            dummy.lookAt(earthCenter);
            // Distance to surface
            const dist = this.orbitRadius - this.earthRadius;
            // Cone width radius
            const radius = dist * Math.tan(angle);
            dummy.scale.set(radius, radius, dist);

            dummy.updateMatrix();
            this.beamMesh.setMatrixAt(i, dummy.matrix);
        }

        this.beamMesh.instanceMatrix.needsUpdate = true;
    }

    update3DOrbits() {
        if (!this.orbitGroup) return;

        // Clear existing
        while (this.orbitGroup.children.length > 0) {
            this.orbitGroup.remove(this.orbitGroup.children[0]);
        }

        if (!this.showOrbits) return;

        const numPlanes = this.params.orbital_planes;
        const inclination = (this.params.inclination * Math.PI) / 180;
        const steps = 128; // Points per orbit circle

        for (let p = 0; p < numPlanes; p++) {
            const raan = (p / numPlanes) * 2 * Math.PI;
            const hue = (p / numPlanes) * 60 + 170;
            const color = new THREE.Color(`hsl(${hue}, 70%, 50%)`);

            const points = [];
            for (let i = 0; i <= steps; i++) {
                const anomaly = (i / steps) * 2 * Math.PI;
                const sinLat = Math.sin(inclination) * Math.sin(anomaly);
                const lat = Math.asin(Math.max(-1, Math.min(1, sinLat)));
                const yArg = Math.cos(inclination) * Math.sin(anomaly);
                const xArg = Math.cos(anomaly);
                const lon = Math.atan2(yArg, xArg) + raan;

                const latDeg = (lat * 180) / Math.PI;
                const lonDeg = (lon * 180) / Math.PI;

                points.push(this.latLonToVector3(latDeg, lonDeg, this.orbitRadius));
            }

            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({ color: color, opacity: 0.4, transparent: true });
            const line = new THREE.Line(geometry, material);
            this.orbitGroup.add(line);
        }
    }

    // --- Rendering ---

    renderStaticLayer() {
        // Only run if in 2D mode, slightly efficient
        if (this.mode !== '2D') return;

        const ctx = this.staticCtx;
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, this.width, this.height);

        // 1. Draw Standard Earth (in map area with proper aspect ratio)
        if (this.imageLoaded && this.earthImage) {
            ctx.globalAlpha = 1.0;
            ctx.drawImage(this.earthImage, this.mapOffsetX, this.mapOffsetY, this.mapWidth, this.mapHeight);
        }

        // 2. Draw Population Overlay (in map area)
        if (this.showPopulation && this.popImage && this.popImage.complete) {
            ctx.globalAlpha = this.popOpacity;
            ctx.drawImage(this.popImage, this.mapOffsetX, this.mapOffsetY, this.mapWidth, this.mapHeight);
            ctx.globalAlpha = 1.0;
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
        for (let i = -180; i <= 180; i += 30) {
            const x = this.mapOffsetX + ((i + 180) / 360) * this.mapWidth;
            ctx.moveTo(x, this.mapOffsetY);
            ctx.lineTo(x, this.mapOffsetY + this.mapHeight);
        }
        for (let i = -90; i <= 90; i += 30) {
            const y = this.mapOffsetY + ((90 - i) / 180) * this.mapHeight;
            ctx.moveTo(this.mapOffsetX, y);
            ctx.lineTo(this.mapOffsetX + this.mapWidth, y);
        }
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 200, 100, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const eqY = this.mapOffsetY + this.mapHeight / 2;
        ctx.moveTo(this.mapOffsetX, eqY);
        ctx.lineTo(this.mapOffsetX + this.mapWidth, eqY);
        ctx.stroke();
    }

    drawOrbitPaths(ctx) {
        const numPlanes = this.params.orbital_planes;
        const inclination = (this.params.inclination * Math.PI) / 180;
        const steps = 360;

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
                lonDeg = ((lonDeg + 180) % 360 + 360) % 360 - 180;

                const pos = this.latLonToXY(latDeg, lonDeg);

                if (i === 0) {
                    ctx.moveTo(pos.x, pos.y);
                } else {
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

        if (this.isPlaying) {
            const orbitPeriod = 5760;
            const radPerSec = (2 * Math.PI) / orbitPeriod;
            this.timeOffset += (delta / 1000) * radPerSec * this.speed;

            // Update Simulated Time
            this.simTime += delta * this.speed;
            const date = new Date(this.simTime);
            this.utcTime.textContent = date.toISOString().substr(11, 8);

            // Rotate Earth (3D only)
            if (this.mode !== '2D' && this.earthMesh) {
                const secondsInDay = date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
                const rotAngle = (secondsInDay / 86400) * 2 * Math.PI;
                this.earthMesh.rotation.y = rotAngle - Math.PI / 2; // -90 deg offset tuning

                if (this.densityMesh3D) {
                    this.densityMesh3D.rotation.y = this.earthMesh.rotation.y;
                }
            }
        }

        // Stats
        this.satCount.textContent = this.params.satellites;
        this.planeCount.textContent = this.params.orbital_planes;

        // --- RENDER 2D ---
        if (this.mode === '2D') {
            // Clear canvas
            this.ctx.save();
            this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            this.ctx.fillStyle = '#111';
            this.ctx.fillRect(0, 0, this.width, this.height);

            // Apply zoom and pan transforms
            this.ctx.translate(this.panX, this.panY);
            this.ctx.scale(this.scale, this.scale);

            if (this.staticLayerDirty) {
                this.renderStaticLayer();
            }
            this.ctx.drawImage(this.staticCanvas, 0, 0, this.width, this.height);

            // Draw Night Shadow
            this.drawNightShadow(this.ctx);

            const totalSats = this.params.satellites;

            // Draw Beams (2D only logic for now)
            if (this.showBeams) {
                this.ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
                this.ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
                this.ctx.lineWidth = 1;
                const angularRadius = this.params.beam_size * 0.14;

                this.ctx.beginPath();
                for (let i = 0; i < totalSats; i++) {
                    const pos = this.getSatellitePosition(i, totalSats, this.timeOffset);
                    const centerLat = pos.lat * Math.PI / 180;
                    const centerLon = pos.lon * Math.PI / 180;

                    const points = [];
                    const segments = 32;
                    let crossesDateLine = false;

                    for (let j = 0; j <= segments; j++) {
                        const brng = (j / segments) * 2 * Math.PI;
                        const p = this.destinationPoint(centerLat, centerLon, angularRadius, brng);
                        p.lon = (p.lon + 3 * Math.PI) % (2 * Math.PI) - Math.PI;

                        const degLat = p.lat * 180 / Math.PI;
                        const degLon = p.lon * 180 / Math.PI;
                        const xy = this.latLonToXY(degLat, degLon);
                        points.push(xy);
                        if (j > 0 && Math.abs(points[j].x - points[j - 1].x) > this.width / 2) {
                            crossesDateLine = true;
                        }
                    }

                    if (!crossesDateLine) {
                        this.ctx.moveTo(points[0].x, points[0].y);
                        for (let k = 1; k < points.length; k++) this.ctx.lineTo(points[k].x, points[k].y);
                    } else {
                        this.ctx.moveTo(points[0].x, points[0].y);
                        for (let k = 1; k < points.length; k++) {
                            if (Math.abs(points[k].x - points[k - 1].x) < this.width / 2) {
                                this.ctx.lineTo(points[k].x, points[k].y);
                            } else {
                                this.ctx.moveTo(points[k].x, points[k].y);
                            }
                        }
                    }
                }
                this.ctx.fill();
                this.ctx.stroke();
            }

            // Draw Satellites
            if (this.satSprite) {
                const offset = this.satSprite.width / 2;
                for (let i = 0; i < totalSats; i++) {
                    const pos = this.getSatellitePosition(i, totalSats, this.timeOffset);
                    const xy = this.latLonToXY(pos.lat, pos.lon);
                    this.ctx.drawImage(this.satSprite, xy.x - offset, xy.y - offset);
                }
            }

            // Restore canvas state after zoom/pan transforms
            this.ctx.restore();
        }
        // --- RENDER 3D ---
        else {
            if (this.satPoints) {
                const totalSats = this.params.satellites;
                const positions = this.satPoints.geometry.attributes.position.array;

                // Resize buffer if needed (simple check)
                if (positions.length < totalSats * 3) {
                    const newPositions = new Float32Array(totalSats * 3);
                    this.satPoints.geometry.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
                }

                this.satPoints.geometry.setDrawRange(0, totalSats);

                const currentPositions = this.satPoints.geometry.attributes.position.array;
                for (let i = 0; i < totalSats; i++) {
                    const pos = this.getSatellitePosition(i, totalSats, this.timeOffset);
                    const vec3 = this.latLonToVector3(pos.lat, pos.lon, this.orbitRadius);
                    currentPositions[i * 3] = vec3.x;
                    currentPositions[i * 3 + 1] = vec3.y;
                    currentPositions[i * 3 + 2] = vec3.z;
                }
                this.satPoints.geometry.attributes.position.needsUpdate = true;
            }

            this.controls.update();

            // Beams update
            if (this.showBeams && this.beamMesh) {
                this.update3DBeams(this.params.satellites);
            }

            this.renderer.render(this.scene, this.camera);
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
