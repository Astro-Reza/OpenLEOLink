/**
 * ISL (Inter-Satellite Link) Visualizer
 * Multi-Constellation Edition — supports 2D Canvas + 3D Three.js
 */

// Distinct color palettes per constellation
const CONSTELLATION_COLORS = [
    { asc: '#64FF64', desc: '#FFA03C', asc3D: [0.39, 1.0, 0.39], desc3D: [1.0, 0.63, 0.24], orbit3DAsc: 0x64C8FF, orbit3DDesc: 0xFFA03C },
    { asc: '#50DCFF', desc: '#FF6B8A', asc3D: [0.31, 0.86, 1.0], desc3D: [1.0, 0.42, 0.54], orbit3DAsc: 0x50DCFF, orbit3DDesc: 0xFF6B8A },
    { asc: '#FFD740', desc: '#B388FF', asc3D: [1.0, 0.84, 0.25], desc3D: [0.70, 0.53, 1.0], orbit3DAsc: 0xFFD740, orbit3DDesc: 0xB388FF },
    { asc: '#69F0AE', desc: '#FF8A65', asc3D: [0.41, 0.94, 0.68], desc3D: [1.0, 0.54, 0.40], orbit3DAsc: 0x69F0AE, orbit3DDesc: 0xFF8A65 },
    { asc: '#40C4FF', desc: '#FF5252', asc3D: [0.25, 0.77, 1.0], desc3D: [1.0, 0.32, 0.32], orbit3DAsc: 0x40C4FF, orbit3DDesc: 0xFF5252 },
    { asc: '#EEFF41', desc: '#E040FB', asc3D: [0.93, 1.0, 0.25], desc3D: [0.88, 0.25, 0.98], orbit3DAsc: 0xEEFF41, orbit3DDesc: 0xE040FB },
];

class ISLVisualizer {
    constructor() {
        this.canvas2D = document.getElementById('orbit-canvas');
        this.container3D = document.getElementById('orbit-container-3d');
        this.ctx = this.canvas2D.getContext('2d', { alpha: false });
        this.loaderScreen = document.getElementById('loader-screen');
        this.appContainer = document.getElementById('app-container');
        this.mode = '2D';

        // 2D Assets
        this.staticCanvas = document.createElement('canvas');
        this.staticCtx = this.staticCanvas.getContext('2d', { alpha: false });
        this.staticLayerDirty = true;

        // 3D Assets
        this.scene = null; this.camera = null; this.renderer = null; this.controls = null;
        this.earthMesh = null;
        this.islLinesGroup = null;
        this.earthRadius = 5;

        // Multi-constellation array
        this.constellations = [];

        // Animation
        this.earthImage = null; this.imageLoaded = false;
        this.timeOffset = 0; this.simTime = Date.now();
        this.lastFrameTime = 0; this.isPlaying = true; this.speed = 1.0;

        // Display toggles
        this.showAscending = true; this.showDescending = true;
        this.showGrid = true; this.showDots = true;
        this.showCrossISL = true; this.showIntraISL = false; this.showInterISL = false;
        this.showRightLeftISL = false;

        // LOS filter: minimum communications altitude (km above Earth surface)
        this.minCommAltitude = 80;

        // 2D zoom/pan
        this.scale = 1.0; this.panX = 0; this.panY = 0;
        this.isPanning = false; this.lastPanX = 0; this.lastPanY = 0;
        this.mapWidth = 0; this.mapHeight = 0; this.mapOffsetX = 0; this.mapOffsetY = 0;

        // UI
        this.satCount = document.getElementById('sat-count');
        this.planeCount = document.getElementById('plane-count');
        this.utcTime = document.getElementById('utc-time');

        // Circle texture for 3D dots (shared)
        this.circleTex = null;

        this.init();
    }

    init() {
        this.setupCanvas();
        this.loadEarthImage();
        document.getElementById('connection-status').textContent = 'ISL Simulation';
        document.querySelector('.status-dot').classList.add('connected');

        // Read existing constellation cards from DOM
        this.readConstellationsFromDOM();

        this.setupControls();
        this.init3D();
        requestAnimationFrame((t) => this.animate(t));

        window.addEventListener('resize', () => {
            this.setupCanvas(); this.handleResize3D(); this.staticLayerDirty = true;
        });

        // 2D zoom
        this.canvas2D.addEventListener('wheel', (e) => {
            if (this.mode !== '2D') return;
            e.preventDefault();
            const f = e.deltaY > 0 ? 0.9 : 1.1;
            const ns = Math.max(1, Math.min(10, this.scale * f));
            const rect = this.canvas2D.getBoundingClientRect();
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            const ps = this.scale; this.scale = ns;
            if (ns !== ps) { const sc = ns / ps; this.panX = mx - (mx - this.panX) * sc; this.panY = my - (my - this.panY) * sc; }
            if (this.scale <= 1) { this.panX = 0; this.panY = 0; this.canvas2D.style.cursor = 'default'; }
            else { this.canvas2D.style.cursor = 'grab'; }
            this.staticLayerDirty = true;
        }, { passive: false });

        // 2D pan
        this.canvas2D.addEventListener('mousedown', (e) => {
            if (this.mode !== '2D' || this.scale <= 1) return;
            this.isPanning = true; this.lastPanX = e.clientX; this.lastPanY = e.clientY;
            this.canvas2D.style.cursor = 'grabbing';
        });
        window.addEventListener('mousemove', (e) => {
            if (!this.isPanning || this.mode !== '2D') return;
            this.panX += e.clientX - this.lastPanX; this.panY += e.clientY - this.lastPanY;
            this.lastPanX = e.clientX; this.lastPanY = e.clientY; this.staticLayerDirty = true;
        });
        window.addEventListener('mouseup', () => { this.isPanning = false; if (this.scale > 1) this.canvas2D.style.cursor = 'grab'; else this.canvas2D.style.cursor = 'default'; });
        this.canvas2D.style.cursor = 'default';
    }

    // === Multi-Constellation Management ===

    readConstellationsFromDOM() {
        const cards = document.querySelectorAll('.db-card[id^="const-card-"]');
        cards.forEach((card, index) => {
            this.constellations.push(this._createConstellationFromCard(card, index));
        });
    }

    _createConstellationFromCard(card, colorIndex) {
        const params = this._readParamsFromCard(card);
        const colors = CONSTELLATION_COLORS[colorIndex % CONSTELLATION_COLORS.length];
        const nameInput = card.querySelector('.db-card-name');
        return {
            id: card.id,
            name: nameInput ? nameInput.value : `Constellation ${colorIndex + 1}`,
            params: params,
            orbitRadius: this._computeOrbitRadius(params.altitude),
            minDot: this._computeMinDot(params.altitude),
            colors: colors,
            // Per-constellation satellite data (computed each frame)
            allSatPositions: [],
            ascSats: [],
            descSats: [],
            crossLinks: [],
            rightLeftLinks: [],
            intraLinks: [],
            interLinks: [],
            // 3D objects (created in init3D / addConstellationFromCard)
            satPoints: null,
            orbitGroup: null,
        };
    }

    _readParamsFromCard(card) {
        const panel = card.querySelector('.db-settings-panel');
        if (!panel) {
            // Read from summary rows if no settings panel
            const getSummary = (key) => {
                const el = card.querySelector(`[data-summary="${key}"]`);
                return el ? parseFloat(el.textContent) : 0;
            };
            return {
                satellites: getSummary('satellites') || 600,
                orbital_planes: getSummary('planes') || 12,
                inclination: getSummary('inclination') || 53,
                altitude: getSummary('altitude') || 550,
            };
        }
        const getParam = (key, fallback) => {
            const el = panel.querySelector(`[data-param="${key}"]`);
            return el ? parseFloat(el.value) : fallback;
        };
        const symToggle = panel.querySelector('.db-toggle-switch input[type="checkbox"]');
        const isSymmetrical = symToggle ? symToggle.checked : true;
        let altitude;
        if (isSymmetrical) {
            altitude = getParam('altitude', 550);
        } else {
            altitude = (getParam('apogee', 600) + getParam('perigee', 500)) / 2;
        }
        return {
            satellites: getParam('satellites', 600),
            orbital_planes: getParam('planes', 12),
            inclination: getParam('inclination', 53),
            altitude: altitude,
        };
    }

    _computeOrbitRadius(altitude) {
        return this.earthRadius * (6371 + altitude) / 6371;
    }

    /**
     * Compute minimum dot-product threshold for LOS validation.
     * From the right-triangle geometry (Figure 14):
     *   R_orbit = R_earth + altitude
     *   R_min   = R_earth + minCommAltitude
     *   minDot  = 2*(R_min/R_orbit)^2 - 1
     * A link is valid when dot(satA, satB) >= minDot.
     */
    _computeMinDot(altitude) {
        const R_EARTH = 6371;
        const rOrbit = R_EARTH + altitude;
        const rMin = R_EARTH + this.minCommAltitude;
        if (rMin >= rOrbit) return 1; // no links possible
        const ratio = rMin / rOrbit;
        return 2 * ratio * ratio - 1;
    }

    /** Called from dashboard JS when + button adds a new card */
    addConstellationFromCard(cardId) {
        const card = document.getElementById(cardId);
        if (!card) return;
        const colorIndex = this.constellations.length;
        const constellation = this._createConstellationFromCard(card, colorIndex);

        // Create 3D objects if scene is ready
        if (this.scene) {
            this._create3DObjectsForConstellation(constellation);
        }

        this.constellations.push(constellation);
        this.staticLayerDirty = true;
    }

    /** Called from dashboard JS when × button removes a card */
    removeConstellation(cardId) {
        const idx = this.constellations.findIndex(c => c.id === cardId);
        if (idx < 0) return;
        const c = this.constellations[idx];

        // Remove 3D objects
        if (c.satPoints && this.scene) {
            this.scene.remove(c.satPoints);
            c.satPoints.geometry.dispose();
            c.satPoints.material.dispose();
        }
        if (c.orbitGroup && this.scene) {
            this._clearGroup(c.orbitGroup);
            this.scene.remove(c.orbitGroup);
        }

        this.constellations.splice(idx, 1);
        this.staticLayerDirty = true;
    }

    /** Called from dashboard JS when slider values change on a card */
    syncConstellationFromCard(cardElement) {
        const cardId = cardElement.id;
        const c = this.constellations.find(c => c.id === cardId);
        if (!c) return;

        // Sync name (lightweight — only reads one DOM attribute)
        const nameInput = cardElement.querySelector('.db-card-name');
        if (nameInput) c.name = nameInput.value;

        const newParams = this._readParamsFromCard(cardElement);
        const altitudeChanged = c.params.altitude !== newParams.altitude;
        const planesChanged = c.params.orbital_planes !== newParams.orbital_planes;
        const incChanged = c.params.inclination !== newParams.inclination;

        c.params = newParams;
        c.orbitRadius = this._computeOrbitRadius(newParams.altitude);
        c.minDot = this._computeMinDot(newParams.altitude);

        if (altitudeChanged || planesChanged || incChanged) {
            this.staticLayerDirty = true;
            this._update3DOrbitsForConstellation(c);
        }
    }

    // === Canvas Setup ===

    initLoadingScreen() {
        const TOTAL_BLOCKS = 20, DURATION = 3500;
        const grid = document.getElementById('progressGrid');
        const pct = document.getElementById('percentText');
        const body = document.getElementById('loaderBody');
        for (let i = 0; i < TOTAL_BLOCKS; i++) { const b = document.createElement('div'); b.className = 'p-block'; grid.appendChild(b); }
        setTimeout(() => { body.classList.add('is-open'); startLoad(); }, 800);
        const startLoad = () => {
            let st = null;
            const anim = (ts) => {
                if (!st) st = ts;
                const p = Math.min((ts - st) / DURATION, 1);
                pct.innerText = Math.floor(p * 100) + '%';
                const bf = Math.floor(p * TOTAL_BLOCKS);
                for (let i = 0; i < TOTAL_BLOCKS; i++) grid.children[i].classList.toggle('filled', i < bf);
                if (p < 1) requestAnimationFrame(anim);
                else {
                    pct.innerText = '100%'; Array.from(grid.children).forEach(b => b.classList.add('filled'));
                    setTimeout(() => { this.loaderScreen.classList.add('hidden'); this.appContainer.style.opacity = '1'; }, 500);
                }
            };
            requestAnimationFrame(anim);
        };
    }

    setupCanvas() {
        const rect = this.canvas2D.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.width = rect.width; this.height = rect.height; this.dpr = dpr;
        this.canvas2D.width = this.width * dpr; this.canvas2D.height = this.height * dpr;
        this.canvas2D.style.width = this.width + 'px'; this.canvas2D.style.height = this.height + 'px';
        const tA = 2.0, cA = this.width / this.height;
        if (cA > tA) { this.mapHeight = this.height; this.mapWidth = this.height * tA; }
        else { this.mapWidth = this.width; this.mapHeight = this.width / tA; }
        this.mapOffsetX = (this.width - this.mapWidth) / 2;
        this.mapOffsetY = (this.height - this.mapHeight) / 2;
        this.staticCanvas.width = this.canvas2D.width; this.staticCanvas.height = this.canvas2D.height;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    loadEarthImage() {
        this.earthImage = new Image(); this.earthImage.crossOrigin = 'anonymous';
        this.earthImage.onload = () => { this.imageLoaded = true; this.staticLayerDirty = true; };
        this.earthImage.src = '/static/textures/8k_earth_daymap.jpg';
    }

    // === Orbital Mechanics (per-constellation) ===

    classifySatellites(c) {
        const total = c.params.satellites, nP = c.params.orbital_planes || 1;
        const spp = Math.ceil(total / nP);
        const inc = (c.params.inclination * Math.PI) / 180;
        c.ascSats = []; c.descSats = []; c.allSatPositions = [];
        for (let i = 0; i < total; i++) {
            const pi2 = i % nP, si2 = Math.floor(i / nP);
            const raan = (pi2 / nP) * 2 * Math.PI;
            const anom = (si2 / spp) * 2 * Math.PI + (pi2 * 0.5) + this.timeOffset;
            const sL = Math.sin(inc) * Math.sin(anom);
            const la = Math.asin(Math.max(-1, Math.min(1, sL)));
            const lo = Math.atan2(Math.cos(inc) * Math.sin(anom), Math.cos(anom)) + raan;
            const px = Math.cos(la) * Math.cos(lo);
            const py = Math.cos(la) * Math.sin(lo);
            const pz = Math.sin(la);
            const latD = (la * 180) / Math.PI;
            let lonD = (lo * 180) / Math.PI;
            lonD = ((lonD + 180) % 360 + 360) % 360 - 180;
            const isAsc = Math.cos(anom) > 0;
            const entry = { idx: i, lat: latD, lon: lonD, latRad: la, lonRad: lo, px, py, pz, isAscending: isAsc, planeIdx: pi2 };
            c.allSatPositions.push(entry);
            if (isAsc) c.ascSats.push(entry);
            else c.descSats.push(entry);
        }
    }

    // === ISL Computation (per-constellation) ===

    computeCrossPlaneISL(c) {
        c.crossLinks = [];
        if (c.ascSats.length === 0 || c.descSats.length === 0) return;
        for (let i = 0; i < c.ascSats.length; i++) {
            const a = c.ascSats[i]; let best = -1, bestDot = -2;
            for (let j = 0; j < c.descSats.length; j++) {
                const d = c.descSats[j];
                const dot = a.px * d.px + a.py * d.py + a.pz * d.pz;
                if (dot > bestDot) { bestDot = dot; best = j; }
            }
            if (best >= 0 && bestDot >= c.minDot) c.crossLinks.push({ asc: i, desc: best });
        }
    }

    computeRightLeftISL(c) {
        c.rightLeftLinks = [];
        if (c.ascSats.length === 0 || c.descSats.length === 0) return;
        const voronoiPairs = new Set();
        if (this.showCrossISL) {
            for (const lk of c.crossLinks) {
                voronoiPairs.add(c.ascSats[lk.asc].idx + '-' + c.descSats[lk.desc].idx);
            }
        }
        for (let j = 0; j < c.descSats.length; j++) {
            const d = c.descSats[j];
            let bestAsc = -1, bestDot = -2;
            for (let i = 0; i < c.ascSats.length; i++) {
                const a = c.ascSats[i];
                const dot = a.px * d.px + a.py * d.py + a.pz * d.pz;
                if (dot > bestDot) { bestDot = dot; bestAsc = i; }
            }
            if (bestAsc < 0 || bestDot < c.minDot) continue;
            const pairKey = c.ascSats[bestAsc].idx + '-' + d.idx;
            if (voronoiPairs.has(pairKey)) continue;
            c.rightLeftLinks.push({ asc: bestAsc, desc: j });
        }
    }

    computeIntraPlaneISL(c) {
        c.intraLinks = [];
        const total = c.params.satellites, nP = c.params.orbital_planes || 1;
        const spp = Math.ceil(total / nP);
        if (spp < 2) return;
        for (let pl = 0; pl < nP; pl++) {
            for (let s = 0; s < spp; s++) {
                const ci = s * nP + pl, ni = ((s + 1) % spp) * nP + pl;
                if (ci >= total || ni >= total) continue;
                const sa = c.allSatPositions[ci], sb = c.allSatPositions[ni];
                if (sa && sb) {
                    const dot = sa.px * sb.px + sa.py * sb.py + sa.pz * sb.pz;
                    if (dot < c.minDot) continue;
                }
                c.intraLinks.push({ from: ci, to: ni });
            }
        }
    }

    computeInterPlaneISL(c) {
        c.interLinks = [];
        const total = c.params.satellites, nP = c.params.orbital_planes || 1;
        if (nP < 2) return;
        const ascByPlane = new Array(nP).fill(null).map(() => []);
        const descByPlane = new Array(nP).fill(null).map(() => []);
        for (let i = 0; i < total; i++) {
            const sat = c.allSatPositions[i];
            if (sat.isAscending) ascByPlane[sat.planeIdx].push(i);
            else descByPlane[sat.planeIdx].push(i);
        }
        const linkPlanes = (listA, listB) => {
            if (listA.length === 0 || listB.length === 0) return;
            for (const ci of listA) {
                const sc = c.allSatPositions[ci];
                let best = -1, bestD = -2;
                for (const ri of listB) {
                    const sr = c.allSatPositions[ri];
                    const dot = sc.px * sr.px + sc.py * sr.py + sc.pz * sr.pz;
                    if (dot > bestD) { bestD = dot; best = ri; }
                }
                if (best >= 0 && bestD >= c.minDot) c.interLinks.push({ from: ci, to: best });
            }
        };
        for (let p = 0; p < nP; p++) {
            const pr = (p + 1) % nP;
            linkPlanes(ascByPlane[p], ascByPlane[pr]);
            linkPlanes(descByPlane[p], descByPlane[pr]);
        }
    }

    // === 2D Coordinate Helpers ===

    latLonToXY(lat, lon) {
        return {
            x: this.mapOffsetX + ((lon + 180) / 360) * this.mapWidth,
            y: this.mapOffsetY + ((90 - lat) / 180) * this.mapHeight
        };
    }

    latLonToVector3(lat, lon, radius) {
        const phi = (90 - lat) * (Math.PI / 180), theta = (lon + 180) * (Math.PI / 180);
        return new THREE.Vector3(-(radius * Math.sin(phi) * Math.cos(theta)),
            radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta));
    }

    vec3ToScreen(px, py, pz) {
        const lat = Math.asin(Math.max(-1, Math.min(1, pz)));
        const lon = Math.atan2(py, px);
        return {
            x: this.mapOffsetX + ((lon + Math.PI) / (2 * Math.PI)) * this.mapWidth,
            y: this.mapOffsetY + ((0.5 - lat / Math.PI)) * this.mapHeight
        };
    }

    // === 2D Drawing (per-constellation) ===

    drawOrbitLinesColored(ctx, c) {
        const nP = c.params.orbital_planes, inc = (c.params.inclination * Math.PI) / 180;
        const steps = 120;
        const ascColor = c.colors.asc;
        const descColor = c.colors.desc;

        for (let p = 0; p < nP; p++) {
            const raan = (p / nP) * 2 * Math.PI;
            let ascPts = [], descPts = [], prevXA = -9999, prevXD = -9999;
            for (let i = 0; i <= steps; i++) {
                // Shift phase by -PI/2 so Ascending (-PI/2 to PI/2) is contiguous in loop
                const anom = ((i / steps) * 2 * Math.PI) - (Math.PI / 2);
                const sL = Math.sin(inc) * Math.sin(anom), la = Math.asin(Math.max(-1, Math.min(1, sL)));
                let lo = Math.atan2(Math.cos(inc) * Math.sin(anom), Math.cos(anom)) + raan;
                lo = (lo + Math.PI) % (2 * Math.PI) - Math.PI;
                const sx = this.mapOffsetX + ((lo + Math.PI) / (2 * Math.PI)) * this.mapWidth;
                const sy = this.mapOffsetY + (0.5 - la / Math.PI) * this.mapHeight;
                const isAsc = Math.cos(anom) > 0;
                if (isAsc) {
                    if (this.showDescending && descPts.length > 1) { ctx.strokeStyle = descColor; ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(descPts[0][0], descPts[0][1]); for (let k = 1; k < descPts.length; k++) ctx.lineTo(descPts[k][0], descPts[k][1]); ctx.stroke(); ctx.globalAlpha = 1; }
                    descPts = []; prevXD = -9999;
                    if (Math.abs(sx - prevXA) > this.mapWidth / 2 && prevXA !== -9999) {
                        if (this.showAscending && ascPts.length > 1) { ctx.strokeStyle = ascColor; ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(ascPts[0][0], ascPts[0][1]); for (let k = 1; k < ascPts.length; k++) ctx.lineTo(ascPts[k][0], ascPts[k][1]); ctx.stroke(); ctx.globalAlpha = 1; }
                        ascPts = [];
                    }
                    ascPts.push([sx, sy]); prevXA = sx;
                } else {
                    if (this.showAscending && ascPts.length > 1) { ctx.strokeStyle = ascColor; ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(ascPts[0][0], ascPts[0][1]); for (let k = 1; k < ascPts.length; k++) ctx.lineTo(ascPts[k][0], ascPts[k][1]); ctx.stroke(); ctx.globalAlpha = 1; }
                    ascPts = []; prevXA = -9999;
                    if (Math.abs(sx - prevXD) > this.mapWidth / 2 && prevXD !== -9999) {
                        if (this.showDescending && descPts.length > 1) { ctx.strokeStyle = descColor; ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(descPts[0][0], descPts[0][1]); for (let k = 1; k < descPts.length; k++) ctx.lineTo(descPts[k][0], descPts[k][1]); ctx.stroke(); ctx.globalAlpha = 1; }
                        descPts = [];
                    }
                    descPts.push([sx, sy]); prevXD = sx;
                }
            }
            if (this.showAscending && ascPts.length > 1) { ctx.strokeStyle = ascColor; ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(ascPts[0][0], ascPts[0][1]); for (let k = 1; k < ascPts.length; k++) ctx.lineTo(ascPts[k][0], ascPts[k][1]); ctx.stroke(); ctx.globalAlpha = 1; }
            if (this.showDescending && descPts.length > 1) { ctx.strokeStyle = descColor; ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(descPts[0][0], descPts[0][1]); for (let k = 1; k < descPts.length; k++) ctx.lineTo(descPts[k][0], descPts[k][1]); ctx.stroke(); ctx.globalAlpha = 1; }
        }
    }

    drawCrossISL2D(ctx, c) {
        if (c.crossLinks.length === 0) return;
        ctx.strokeStyle = 'rgba(255, 80, 255, 0.7)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (const link of c.crossLinks) {
            const a = c.ascSats[link.asc], d = c.descSats[link.desc];
            const ap = this.vec3ToScreen(a.px, a.py, a.pz), dp = this.vec3ToScreen(d.px, d.py, d.pz);
            if (Math.abs(ap.x - dp.x) > this.mapWidth / 2) continue;
            ctx.moveTo(ap.x, ap.y); ctx.lineTo(dp.x, dp.y);
        }
        ctx.stroke();
    }

    drawRightLeftISL2D(ctx, c) {
        if (c.rightLeftLinks.length === 0) return;
        ctx.strokeStyle = 'rgba(255, 215, 64, 0.7)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (const link of c.rightLeftLinks) {
            const a = c.ascSats[link.asc], d = c.descSats[link.desc];
            const ap = this.vec3ToScreen(a.px, a.py, a.pz), dp = this.vec3ToScreen(d.px, d.py, d.pz);
            if (Math.abs(ap.x - dp.x) > this.mapWidth / 2) continue;
            ctx.moveTo(ap.x, ap.y); ctx.lineTo(dp.x, dp.y);
        }
        ctx.stroke();
    }

    drawIntraPlaneISL2D(ctx, c) {
        if (c.intraLinks.length === 0) return;
        ctx.strokeStyle = 'rgba(180, 255, 80, 0.55)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (const link of c.intraLinks) {
            const a = c.allSatPositions[link.from], b = c.allSatPositions[link.to];
            const ap = this.latLonToXY(a.lat, a.lon), bp = this.latLonToXY(b.lat, b.lon);
            if (Math.abs(ap.x - bp.x) > this.mapWidth / 2) continue;
            ctx.moveTo(ap.x, ap.y); ctx.lineTo(bp.x, bp.y);
        }
        ctx.stroke();
    }

    drawInterPlaneISL2D(ctx, c) {
        if (c.interLinks.length === 0) return;
        ctx.strokeStyle = 'rgba(80, 220, 255, 0.55)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (const link of c.interLinks) {
            const a = c.allSatPositions[link.from], b = c.allSatPositions[link.to];
            const ap = this.latLonToXY(a.lat, a.lon), bp = this.latLonToXY(b.lat, b.lon);
            if (Math.abs(ap.x - bp.x) > this.mapWidth / 2) continue;
            ctx.moveTo(ap.x, ap.y); ctx.lineTo(bp.x, bp.y);
        }
        ctx.stroke();
    }

    drawSatellites2D(ctx, c) {
        if (!this.showDots) return;
        const ascColor = c.colors.asc;
        const descColor = c.colors.desc;
        for (const sat of c.allSatPositions) {
            const xy = this.latLonToXY(sat.lat, sat.lon);
            ctx.fillStyle = sat.isAscending ? ascColor : descColor;
            ctx.beginPath();
            ctx.arc(xy.x, xy.y, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawGrid(ctx) {
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 0.5; ctx.beginPath();
        for (let i = -180; i <= 180; i += 30) { const x = this.mapOffsetX + ((i + 180) / 360) * this.mapWidth; ctx.moveTo(x, this.mapOffsetY); ctx.lineTo(x, this.mapOffsetY + this.mapHeight); }
        for (let i = -90; i <= 90; i += 30) { const y = this.mapOffsetY + ((90 - i) / 180) * this.mapHeight; ctx.moveTo(this.mapOffsetX, y); ctx.lineTo(this.mapOffsetX + this.mapWidth, y); }
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,200,100,0.3)'; ctx.lineWidth = 1; ctx.beginPath();
        const ey = this.mapOffsetY + this.mapHeight / 2; ctx.moveTo(this.mapOffsetX, ey); ctx.lineTo(this.mapOffsetX + this.mapWidth, ey); ctx.stroke();
        ctx.fillStyle = 'rgba(180,180,180,0.8)'; ctx.font = '10px Arial';
        for (let lat = -60; lat <= 60; lat += 30) {
            const y = this.mapOffsetY + ((90 - lat) / 180) * this.mapHeight;
            ctx.fillText(lat === 0 ? '0° (Eq)' : lat + '°', this.mapOffsetX + 4, y - 3);
        }
        for (let lon = -150; lon <= 180; lon += 30) {
            const x = this.mapOffsetX + ((lon + 180) / 360) * this.mapWidth;
            ctx.fillText(lon + '°', x + 3, this.mapOffsetY + this.mapHeight - 4);
        }
    }

    drawNightShadow(ctx) {
        const d = new Date(this.simTime), utcD = d.getUTCHours() + d.getUTCMinutes() / 60;
        let sL = (12 - utcD) * 15; sL = ((sL + 180) % 360 + 360) % 360 - 180;
        let nL = sL + 180; if (nL > 180) nL -= 360;
        let s = nL - 90, e = nL + 90;
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        const lx = (lon) => this.mapOffsetX + ((lon + 180) / 360) * this.mapWidth;
        if (s < -180) { ctx.fillRect(lx(s + 360), this.mapOffsetY, lx(180) - lx(s + 360), this.mapHeight); ctx.fillRect(lx(-180), this.mapOffsetY, lx(e) - lx(-180), this.mapHeight); }
        else if (e > 180) { ctx.fillRect(lx(s), this.mapOffsetY, lx(180) - lx(s), this.mapHeight); ctx.fillRect(lx(-180), this.mapOffsetY, lx(e - 360) - lx(-180), this.mapHeight); }
        else ctx.fillRect(lx(s), this.mapOffsetY, lx(e) - lx(s), this.mapHeight);
    }

    renderStaticLayer() {
        if (this.mode !== '2D') return;
        const ctx = this.staticCtx;
        ctx.fillStyle = '#111'; ctx.fillRect(0, 0, this.width, this.height);
        if (this.imageLoaded && this.earthImage) ctx.drawImage(this.earthImage, this.mapOffsetX, this.mapOffsetY, this.mapWidth, this.mapHeight);
        if (this.showGrid) this.drawGrid(ctx);
        // Draw orbit lines for ALL constellations
        if (this.showAscending || this.showDescending) {
            for (const c of this.constellations) {
                this.drawOrbitLinesColored(ctx, c);
            }
        }
        this.staticLayerDirty = false;
    }

    // === 3D ===

    _createCircleTexture() {
        const circleCanvas = document.createElement('canvas');
        circleCanvas.width = 16; circleCanvas.height = 16;
        const cCtx = circleCanvas.getContext('2d');
        cCtx.fillStyle = '#ffffff'; cCtx.beginPath();
        cCtx.arc(8, 8, 7, 0, Math.PI * 2); cCtx.fill();
        return new THREE.CanvasTexture(circleCanvas);
    }

    _create3DObjectsForConstellation(c) {
        // Satellite points
        const maxSats = c.params.satellites;
        const sGeo = new THREE.BufferGeometry();
        const pos = new Float32Array(maxSats * 3);
        const cols = new Float32Array(maxSats * 3);
        sGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        sGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        c.satPoints = new THREE.Points(sGeo, new THREE.PointsMaterial({
            size: 0.08, map: this.circleTex, vertexColors: true, transparent: true,
            depthWrite: false, alphaTest: 0.1
        }));
        this.scene.add(c.satPoints);

        // Orbit group
        c.orbitGroup = new THREE.Group();
        this.scene.add(c.orbitGroup);

        this._update3DOrbitsForConstellation(c);
    }

    init3D() {
        const mgr = new THREE.LoadingManager();
        mgr.onLoad = () => { const l = document.getElementById('loader-screen'); if (l) l.classList.add('hidden'); const a = document.getElementById('app-container'); if (a) a.style.opacity = '1'; };
        this.scene = new THREE.Scene();
        const aspect = this.container3D.clientWidth / this.container3D.clientHeight;
        this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 2000);
        this.camera.position.set(0, 10, 20);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(this.container3D.clientWidth, this.container3D.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container3D.appendChild(this.renderer.domElement);
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true; this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 7; this.controls.maxDistance = 50;

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.3));
        const sunDir = new THREE.Vector3(-50, 20, -50).normalize();
        const pl = new THREE.PointLight(0xffffff, 1.5); pl.position.copy(sunDir).multiplyScalar(800); this.scene.add(pl);
        const sG = new THREE.SphereGeometry(20, 32, 32), sM = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const sm = new THREE.Mesh(sG, sM); sm.position.copy(pl.position); this.scene.add(sm);
        [{ r: 25, o: 0.6 }, { r: 35, o: 0.3 }, { r: 50, o: 0.15 }].forEach(g => {
            const m = new THREE.Mesh(new THREE.SphereGeometry(g.r, 32, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: g.o, blending: THREE.AdditiveBlending }));
            m.position.copy(pl.position); this.scene.add(m);
        });

        // Starfield
        const tl = new THREE.TextureLoader(mgr);
        const starM = new THREE.Mesh(new THREE.SphereGeometry(1500, 64, 64), new THREE.MeshBasicMaterial({ map: tl.load('/static/textures/8k_stars_milky_way.jpg'), side: THREE.BackSide }));
        this.scene.add(starM);

        // Earth with day/night shader
        const dT = tl.load('/static/textures/8k_earth_daymap.jpg'), nT = tl.load('/static/textures/8k_earth_nightmap.jpg');
        const eMat = new THREE.ShaderMaterial({
            uniforms: { dayTexture: { value: dT }, nightTexture: { value: nT }, sunDirection: { value: sunDir } },
            vertexShader: `varying vec2 vUv; varying vec3 vN; void main(){vUv=uv;vN=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
            fragmentShader: `uniform sampler2D dayTexture,nightTexture;uniform vec3 sunDirection;varying vec2 vUv;varying vec3 vN;void main(){float i=dot(vN,sunDirection);float m=smoothstep(-0.2,0.2,i);vec3 dc=texture2D(dayTexture,vUv).rgb,nc=texture2D(nightTexture,vUv).rgb;gl_FragColor=vec4(mix(nc,dc,m),1.0);}`
        });
        this.earthMesh = new THREE.Mesh(new THREE.SphereGeometry(this.earthRadius, 64, 64), eMat);
        this.scene.add(this.earthMesh);

        // Create shared circle texture
        this.circleTex = this._createCircleTexture();

        // ISL lines group (shared, rebuilt each frame)
        this.islLinesGroup = new THREE.Group(); this.scene.add(this.islLinesGroup);

        // Create 3D objects for each existing constellation
        for (const c of this.constellations) {
            this._create3DObjectsForConstellation(c);
        }
    }

    handleResize3D() {
        if (!this.camera || !this.renderer) return;
        const w = this.container3D.clientWidth, h = this.container3D.clientHeight;
        this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h);
    }

    _clearGroup(group) {
        while (group.children.length > 0) {
            const child = group.children[0];
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
            group.remove(child);
        }
    }

    _update3DOrbitsForConstellation(c) {
        if (!c.orbitGroup) return;
        this._clearGroup(c.orbitGroup);
        if (!this.showAscending && !this.showDescending) return;
        const nP = c.params.orbital_planes, inc = (c.params.inclination * Math.PI) / 180, steps = 128;
        for (let p = 0; p < nP; p++) {
            const raan = (p / nP) * 2 * Math.PI;
            let ascPts = [], descPts = [];
            for (let i = 0; i <= steps; i++) {
                // Shift phase by -PI/2 so Ascending (-PI/2 to PI/2) is contiguous in loop
                const anom = ((i / steps) * 2 * Math.PI) - (Math.PI / 2);
                const sL = Math.sin(inc) * Math.sin(anom), la = Math.asin(Math.max(-1, Math.min(1, sL)));
                const lo = Math.atan2(Math.cos(inc) * Math.sin(anom), Math.cos(anom)) + raan;
                const latD = (la * 180) / Math.PI, lonD = (lo * 180) / Math.PI;
                const v = this.latLonToVector3(latD, lonD, c.orbitRadius);
                if (Math.cos(anom) > 0) ascPts.push(v); else descPts.push(v);
            }
            if (this.showAscending && ascPts.length > 1) {
                const g = new THREE.BufferGeometry().setFromPoints(ascPts);
                c.orbitGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: c.colors.orbit3DAsc, opacity: 0.5, transparent: true })));
            }
            if (this.showDescending && descPts.length > 1) {
                const g = new THREE.BufferGeometry().setFromPoints(descPts);
                c.orbitGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: c.colors.orbit3DDesc, opacity: 0.5, transparent: true })));
            }
        }
    }

    update3DOrbits() {
        for (const c of this.constellations) {
            this._update3DOrbitsForConstellation(c);
        }
    }

    update3DISLLinks() {
        if (!this.islLinesGroup) return;
        this._clearGroup(this.islLinesGroup);

        for (const c of this.constellations) {
            // Cross-plane ISL (magenta)
            if (this.showCrossISL && c.crossLinks.length > 0) {
                const pts = [];
                for (const lk of c.crossLinks) {
                    const a = c.ascSats[lk.asc], d = c.descSats[lk.desc];
                    pts.push(this.latLonToVector3(a.lat, a.lon, c.orbitRadius));
                    pts.push(this.latLonToVector3(d.lat, d.lon, c.orbitRadius));
                }
                if (pts.length > 0) {
                    const g = new THREE.BufferGeometry().setFromPoints(pts);
                    this.islLinesGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xFF50FF, opacity: 0.6, transparent: true })));
                }
            }

            // Intra-plane ISL (yellow-green)
            if (this.showIntraISL && c.intraLinks.length > 0) {
                const pts = [];
                for (const lk of c.intraLinks) {
                    const a = c.allSatPositions[lk.from], b = c.allSatPositions[lk.to];
                    pts.push(this.latLonToVector3(a.lat, a.lon, c.orbitRadius));
                    pts.push(this.latLonToVector3(b.lat, b.lon, c.orbitRadius));
                }
                if (pts.length > 0) {
                    const g = new THREE.BufferGeometry().setFromPoints(pts);
                    this.islLinesGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xB4FF50, opacity: 0.5, transparent: true })));
                }
            }

            // Inter-plane ISL (cyan)
            if (this.showInterISL && c.interLinks.length > 0) {
                const pts = [];
                for (const lk of c.interLinks) {
                    const a = c.allSatPositions[lk.from], b = c.allSatPositions[lk.to];
                    pts.push(this.latLonToVector3(a.lat, a.lon, c.orbitRadius));
                    pts.push(this.latLonToVector3(b.lat, b.lon, c.orbitRadius));
                }
                if (pts.length > 0) {
                    const g = new THREE.BufferGeometry().setFromPoints(pts);
                    this.islLinesGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x50DCFF, opacity: 0.5, transparent: true })));
                }
            }

            // Right-Left ISL (yellow)
            if (this.showRightLeftISL && c.rightLeftLinks.length > 0) {
                const pts = [];
                for (const lk of c.rightLeftLinks) {
                    const a = c.ascSats[lk.asc], d = c.descSats[lk.desc];
                    pts.push(this.latLonToVector3(a.lat, a.lon, c.orbitRadius));
                    pts.push(this.latLonToVector3(d.lat, d.lon, c.orbitRadius));
                }
                if (pts.length > 0) {
                    const g = new THREE.BufferGeometry().setFromPoints(pts);
                    this.islLinesGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xFFD740, opacity: 0.6, transparent: true })));
                }
            }
        }
    }

    // === Mode Switching ===

    setMode(mode) {
        this.mode = mode;
        const b2 = document.getElementById('btn-2d'), b3 = document.getElementById('btn-3d');
        if (mode === '2D') { this.canvas2D.style.display = 'block'; this.container3D.style.display = 'none'; b2.classList.add('active'); b3.classList.remove('active'); }
        else { this.canvas2D.style.display = 'none'; this.container3D.style.display = 'block'; b2.classList.remove('active'); b3.classList.add('active'); }
        this.handleResize3D();
    }

    // === Controls ===

    setupControls() {
        const sl = (id) => document.getElementById(id);
        sl('speed-slider').addEventListener('input', e => { const v = parseFloat(e.target.value); sl('speed-value').textContent = v.toFixed(1) + 'x'; this.speed = v; });
        sl('btn-2d').addEventListener('click', () => this.setMode('2D'));
        sl('btn-3d').addEventListener('click', () => this.setMode('3D'));

        // Checkboxes
        sl('cb-ascending')?.addEventListener('change', e => { this.showAscending = e.target.checked; this.staticLayerDirty = true; this.update3DOrbits(); });
        sl('cb-descending')?.addEventListener('change', e => { this.showDescending = e.target.checked; this.staticLayerDirty = true; this.update3DOrbits(); });
        sl('cb-grid')?.addEventListener('change', e => { this.showGrid = e.target.checked; this.staticLayerDirty = true; });
        sl('cb-dots')?.addEventListener('change', e => { this.showDots = e.target.checked; });
        sl('cb-cross-isl')?.addEventListener('change', e => { this.showCrossISL = e.target.checked; });
        sl('cb-intra-isl')?.addEventListener('change', e => { this.showIntraISL = e.target.checked; });
        sl('cb-inter-isl')?.addEventListener('change', e => { this.showInterISL = e.target.checked; });
        sl('cb-rl-isl')?.addEventListener('change', e => { this.showRightLeftISL = e.target.checked; });

        // Min communications altitude slider
        const mcaSlider = sl('min-comm-alt');
        if (mcaSlider) {
            mcaSlider.addEventListener('input', e => {
                this.minCommAltitude = parseFloat(e.target.value);
                sl('min-comm-alt-val').textContent = this.minCommAltitude + ' km';
                for (const c of this.constellations) {
                    c.minDot = this._computeMinDot(c.params.altitude);
                }
            });
        }

        sl('play-btn').addEventListener('click', () => { this.isPlaying = !this.isPlaying; this.updatePlayButton(); });
        sl('reset-time-btn')?.addEventListener('click', () => { this.simTime = Date.now(); this.utcTime.textContent = new Date(this.simTime).toISOString().substr(11, 8); });
    }

    updatePlayButton() {
        const pl = document.getElementById('play-icon'), pa = document.getElementById('pause-icon');
        if (this.isPlaying) { pl.style.display = 'none'; pa.style.display = 'block'; }
        else { pl.style.display = 'block'; pa.style.display = 'none'; }
    }

    // === Main Animation Loop ===
    animate(timestamp) {
        if (!this.lastFrameTime) this.lastFrameTime = timestamp;
        const delta = timestamp - this.lastFrameTime;
        this.lastFrameTime = timestamp;

        if (this.isPlaying) {
            const radPerSec = (2 * Math.PI) / 5760;
            this.timeOffset += (delta / 1000) * radPerSec * this.speed;
            this.simTime += delta * this.speed;
            this.utcTime.textContent = new Date(this.simTime).toISOString().substr(11, 8);
            if (this.mode !== '2D' && this.earthMesh) {
                const d = new Date(this.simTime);
                const s = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
                this.earthMesh.rotation.y = (s / 86400) * 2 * Math.PI - Math.PI / 2;
            }
        }

        // Update info panel with totals across all constellations
        let totalSats = 0, totalPlanes = 0;
        for (const c of this.constellations) {
            totalSats += c.params.satellites;
            totalPlanes += c.params.orbital_planes;
        }
        this.satCount.textContent = totalSats;
        this.planeCount.textContent = totalPlanes;

        // Classify and compute ISL for ALL constellations
        for (const c of this.constellations) {
            this.classifySatellites(c);
            if (this.showCrossISL || this.showRightLeftISL) this.computeCrossPlaneISL(c);
            if (this.showRightLeftISL) this.computeRightLeftISL(c);
            if (this.showIntraISL) this.computeIntraPlaneISL(c);
            if (this.showInterISL) this.computeInterPlaneISL(c);
        }

        if (this.mode === '2D') {
            this.ctx.save();
            this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            this.ctx.fillStyle = '#111'; this.ctx.fillRect(0, 0, this.width, this.height);
            this.ctx.translate(this.panX, this.panY); this.ctx.scale(this.scale, this.scale);
            if (this.staticLayerDirty) this.renderStaticLayer();
            this.ctx.drawImage(this.staticCanvas, 0, 0, this.width, this.height);
            this.drawNightShadow(this.ctx);

            // ISL links + satellites for ALL constellations
            for (const c of this.constellations) {
                if (this.showCrossISL) this.drawCrossISL2D(this.ctx, c);
                if (this.showIntraISL) this.drawIntraPlaneISL2D(this.ctx, c);
                if (this.showInterISL) this.drawInterPlaneISL2D(this.ctx, c);
                if (this.showRightLeftISL) this.drawRightLeftISL2D(this.ctx, c);
                this.drawSatellites2D(this.ctx, c);
            }
            this.ctx.restore();
        } else {
            // 3D render — update each constellation's points
            for (const c of this.constellations) {
                if (!c.satPoints) continue;
                c.satPoints.visible = this.showDots;
                const total = c.params.satellites;
                const pos = c.satPoints.geometry.attributes.position.array;
                if (pos.length < total * 3) {
                    c.satPoints.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
                    c.satPoints.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
                }
                c.satPoints.geometry.setDrawRange(0, total);
                const cp = c.satPoints.geometry.attributes.position.array;
                const cc = c.satPoints.geometry.attributes.color.array;
                for (let i = 0; i < total; i++) {
                    const sat = c.allSatPositions[i];
                    const v = this.latLonToVector3(sat.lat, sat.lon, c.orbitRadius);
                    cp[i * 3] = v.x; cp[i * 3 + 1] = v.y; cp[i * 3 + 2] = v.z;
                    if (sat.isAscending) { cc[i * 3] = c.colors.asc3D[0]; cc[i * 3 + 1] = c.colors.asc3D[1]; cc[i * 3 + 2] = c.colors.asc3D[2]; }
                    else { cc[i * 3] = c.colors.desc3D[0]; cc[i * 3 + 1] = c.colors.desc3D[1]; cc[i * 3 + 2] = c.colors.desc3D[2]; }
                }
                c.satPoints.geometry.attributes.position.needsUpdate = true;
                c.satPoints.geometry.attributes.color.needsUpdate = true;
            }
            this.update3DISLLinks();
            this.controls.update();
            this.renderer.render(this.scene, this.camera);
        }

        requestAnimationFrame((t) => this.animate(t));
    }
}

// Dropdown toggle
function toggleDropdown(id) { document.getElementById(id).classList.toggle('is-open'); }

// Create globally accessible visualizer instance
let islVisualizer = null;
document.addEventListener('DOMContentLoaded', () => {
    islVisualizer = new ISLVisualizer();
    window.islVisualizer = islVisualizer;
});
