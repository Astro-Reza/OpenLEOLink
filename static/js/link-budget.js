/**
 * Client-Side Link Budget Calculator
 * Monte Carlo simulation for LEO satellite link budget analysis
 * With Time-Series Analysis for Contact Duration and Gamma Distribution
 */

class LinkBudgetCalculator {
    constructor() {
        this.Re = 6371.0; // Earth Radius (km)
        this.GM = 3.986e5; // Earth gravitational parameter (km^3/s^2)
        this.nSamples = 30000; // Monte Carlo samples
    }

    /**
     * Generate random uniform samples
     */
    randomUniform(min, max, n) {
        const samples = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            samples[i] = min + Math.random() * (max - min);
        }
        return samples;
    }

    /**
     * Calculate link budget with Monte Carlo simulation
     */
    calculate(params) {
        const { altitude, inclination, latitude, minElevation, frequency, eirp, gr, requiredPower } = params;

        const h = altitude;
        const inc = inclination * Math.PI / 180;
        const latEs = latitude * Math.PI / 180;
        const thetaMin = minElevation * Math.PI / 180;
        const r = this.Re + h;

        // Monte Carlo samples
        const M = this.randomUniform(0, 2 * Math.PI, this.nSamples);
        const Omega = this.randomUniform(0, 2 * Math.PI, this.nSamples);

        // Earth station position
        const xEs = this.Re * Math.cos(latEs);
        const yEs = 0;
        const zEs = this.Re * Math.sin(latEs);

        // Arrays for visible samples
        const thetaSamples = [];
        const slantRangeSamples = [];
        const prSamples = [];
        const fsplSamples = [];

        for (let i = 0; i < this.nSamples; i++) {
            // Satellite position
            const cosM = Math.cos(M[i]);
            const sinM = Math.sin(M[i]);
            const cosO = Math.cos(Omega[i]);
            const sinO = Math.sin(Omega[i]);
            const cosInc = Math.cos(inc);
            const sinInc = Math.sin(inc);

            const xSat = r * (cosO * cosM - sinO * sinM * cosInc);
            const ySat = r * (sinO * cosM + cosO * sinM * cosInc);
            const zSat = r * (sinM * sinInc);

            // Slant range
            const rx = xSat - xEs;
            const ry = ySat - yEs;
            const rz = zSat - zEs;
            const rangeKm = Math.sqrt(rx * rx + ry * ry + rz * rz);

            // Elevation angle
            const zenithDotRange = (xEs * rx + yEs * ry + zEs * rz) / this.Re;
            const sinEl = zenithDotRange / rangeKm;
            const thetaRad = Math.asin(Math.max(-1, Math.min(1, sinEl)));

            // Check visibility
            if (thetaRad >= thetaMin) {
                thetaSamples.push(thetaRad * 180 / Math.PI);
                slantRangeSamples.push(rangeKm);

                // FSPL calculation
                const fspl = 92.45 + 20 * Math.log10(rangeKm) + 20 * Math.log10(frequency);
                const zenithLoss = 0.5 / Math.sin(thetaRad);
                const totalAttenuation = fspl + zenithLoss;
                const sysLoss = 2.0;
                const pr = eirp + gr - totalAttenuation - sysLoss;

                prSamples.push(pr);
                fsplSamples.push(totalAttenuation);
            }
        }

        if (prSamples.length === 0) {
            return { error: "No visibility. Satellite never passes over this location with these parameters." };
        }

        // Statistical calculations
        const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
        const std = arr => {
            const m = mean(arr);
            return Math.sqrt(arr.reduce((acc, val) => acc + (val - m) ** 2, 0) / arr.length);
        };

        const expectedPr = mean(prSamples);
        const worstPr = Math.min(...prSamples);
        const bestPr = Math.max(...prSamples);
        const stdPr = std(prSamples);

        const results = {
            expected_pr: expectedPr,
            worst_case_pr: worstPr,
            best_case_pr: bestPr,
            std_dev_pr: stdPr,
            samples_count: prSamples.length,
            visibility_ratio: (prSamples.length / this.nSamples) * 100,
            link_margin_expected: expectedPr - requiredPower,
            link_margin_worst: worstPr - requiredPower,
            link_margin_best: bestPr - requiredPower,
            // Raw data for charts
            chartData: {
                thetaSamples,
                slantRangeSamples,
                prSamples,
                fsplSamples,
                requiredPower
            }
        };

        return results;
    }

    /**
     * Run time-series simulation for contact duration analysis
     */
    runTimeSeriesSimulation(params, days = 60, stepS = 10) {
        const { altitude, inclination, latitude, minElevation } = params;

        const h = altitude;
        const inc = inclination * Math.PI / 180;
        const latEs = latitude * Math.PI / 180;
        const thetaMinRad = minElevation * Math.PI / 180;
        const rOrbit = this.Re + h;

        // Mean motion
        const n = Math.sqrt(this.GM / Math.pow(rOrbit, 3));

        // Time array
        const totalSeconds = days * 24 * 3600;
        const numSteps = Math.floor(totalSeconds / stepS);

        // J2 Perturbation
        const J2 = 1.08263e-3;
        const raanRate = -1.5 * n * J2 * Math.pow(this.Re / rOrbit, 2) * Math.cos(inc);

        // Earth rotation rate
        const we = 7.292115e-5;

        // Random start longitude
        const startLon = Math.random() * 2 * Math.PI;

        // Earth station vector (Initial at t=0, Lon=0)
        // We rotate this vector by Earth rotation rate we
        const cosLat = Math.cos(latEs);
        const sinLat = Math.sin(latEs);

        const thetaArray = [];
        const visibleTheta = [];
        const contactDurations = [];
        let currentPass = null;
        const allPasses = [];

        // Propagate orbit
        for (let i = 0; i < numSteps; i++) {
            const t = i * stepS;
            const timeVal = t;

            // J2 disturbed Mean Anomaly & RAAN
            const M = n * timeVal;
            const currentRaan = startLon + raanRate * timeVal;

            // Sat ECI Position
            // (Simplified Circular Orbit propagation)
            const u = M + 0; // Argument of Latitude (assuming circ, w=0, M=u)
            const xPrime = rOrbit * Math.cos(u);
            const yPrime = rOrbit * Math.sin(u);

            const xSat = xPrime * Math.cos(currentRaan) - yPrime * Math.cos(inc) * Math.sin(currentRaan);
            const ySat = xPrime * Math.sin(currentRaan) + yPrime * Math.cos(inc) * Math.cos(currentRaan);
            const zSat = yPrime * Math.sin(inc);

            // Earth Rotation angle (thetaG)
            const thetaG = we * timeVal;

            // Earth Station ECI Position
            const xEsRot = (this.Re * cosLat) * Math.cos(thetaG);
            const yEsRot = (this.Re * cosLat) * Math.sin(thetaG);
            const zEsRot = (this.Re * sinLat);

            // Range Vector (ECI)
            const rx = xSat - xEsRot;
            const ry = ySat - yEsRot;
            const rz = zSat - zEsRot;
            const range = Math.sqrt(rx * rx + ry * ry + rz * rz);

            // Topocentric Coordinates System Unit Vectors
            // Up vector (Normal to surface)
            const ux = xEsRot / this.Re;
            const uy = yEsRot / this.Re;
            const uz = zEsRot / this.Re;

            // East Vector (Tangent to parallel)
            // vector = [-sin(thetaG), cos(thetaG), 0]
            const ex = -Math.sin(thetaG);
            const ey = Math.cos(thetaG);
            const ez = 0;

            // North Vector (Tangent to meridian)
            // N = Up x East? No, Up x East is North? 
            // Up(Rad) x East = North. 
            // Let's check: Up(Equator, 0) = (1,0,0). East = (0,1,0). Up x East = (0,0,1) = North. Correct.
            const nx = uy * ez - uz * ey;
            const ny = uz * ex - ux * ez;
            const nz = ux * ey - uy * ex;

            // Project Range vector onto Topocentric Basis
            const rUp = rx * ux + ry * uy + rz * uz;
            const rEast = rx * ex + ry * ey + rz * ez;
            const rNorth = rx * nx + ry * ny + rz * nz;

            // Elevation
            const sinEl = rUp / range;
            const elRad = Math.asin(Math.max(-1, Math.min(1, sinEl)));
            const elDeg = elRad * 180 / Math.PI;

            // Azimuth
            // atan2(East, North) -> 0 is North, 90 is East
            const azRad = Math.atan2(rEast, rNorth);
            let azDeg = azRad * 180 / Math.PI;
            if (azDeg < 0) azDeg += 360;

            thetaArray.push(elRad); // Store raw elevation for general tracking

            // Check visibility
            if (elRad >= thetaMinRad) {
                visibleTheta.push(elDeg);

                // Track Pass
                if (!currentPass) {
                    currentPass = { start: t, track: [] };
                }
                currentPass.track.push({ az: azDeg, el: elDeg });
            } else {
                if (currentPass) {
                    // Pass ended
                    currentPass.duration = t - currentPass.start;
                    // Only keep significant passes
                    if (currentPass.track.length > 2) { // At least 3 points to define a path
                        contactDurations.push(currentPass.duration);
                        allPasses.push(currentPass);
                    }
                    currentPass = null;
                }
            }
        }

        // Handle active pass at end
        if (currentPass) {
            currentPass.duration = totalSeconds - currentPass.start;
            if (currentPass.track.length > 2) {
                contactDurations.push(currentPass.duration);
                allPasses.push(currentPass);
            }
        }

        // --- Post-Processing: Fit Gamma & PDF/CDF ---

        // Identify 3D Visualization Passes (Shortest, Median, Longest)
        allPasses.sort((a, b) => a.duration - b.duration);

        const passes3D = {
            shortest: allPasses.length > 0 ? allPasses[0] : null,
            median: allPasses.length > 0 ? allPasses[Math.floor(allPasses.length / 2)] : null,
            longest: allPasses.length > 0 ? allPasses[allPasses.length - 1] : null
        };

        const gammaParams = this.fitGamma(visibleTheta);

        // Generate PDF/CDF Data (Same as before)
        const sortedTheta = [...visibleTheta].sort((a, b) => a - b);
        const minTheta = minElevation;
        const maxTheta = 90;
        const pdfX = [];
        const pdfY = [];
        const cdfEmpiricalY = [];
        const cdfGammaY = [];

        // Generate smooth PDF curve
        for (let x = minTheta; x <= maxTheta; x += 0.5) {
            pdfX.push(x);
            pdfY.push(this.gammaPDF(x, gammaParams.alpha, gammaParams.loc, gammaParams.beta));
        }

        // Empirical CDF
        for (let i = 0; i < sortedTheta.length; i++) {
            cdfEmpiricalY.push((i + 1) / sortedTheta.length);
            cdfGammaY.push(this.gammaCDF(sortedTheta[i], gammaParams.alpha, gammaParams.loc, gammaParams.beta));
        }

        return {
            days,
            stepS,
            contactDurations,
            meanContactDuration: contactDurations.length > 0 ?
                contactDurations.reduce((a, b) => a + b, 0) / contactDurations.length : 0,
            numContacts: contactDurations.length,
            visibleTheta,
            gammaParams,
            pdfData: { x: pdfX, y: pdfY },
            cdfData: {
                x: sortedTheta,
                empiricalY: cdfEmpiricalY,
                gammaY: cdfGammaY
            },
            passes3D
        };
    }

    /**
     * Fit Gamma distribution parameters using method of moments
     */
    fitGamma(data) {
        if (data.length === 0) {
            return { alpha: 1, loc: 0, beta: 1 };
        }

        const mean = data.reduce((a, b) => a + b, 0) / data.length;
        const variance = data.reduce((acc, val) => acc + (val - mean) ** 2, 0) / data.length;
        const loc = Math.min(...data) * 0.9; // Shift parameter

        const shiftedMean = mean - loc;
        const alpha = (shiftedMean * shiftedMean) / variance;
        const beta = variance / shiftedMean;

        return { alpha: Math.max(0.1, alpha), loc, beta: Math.max(0.1, beta) };
    }

    /**
     * Gamma PDF
     */
    gammaPDF(x, alpha, loc, beta) {
        const z = (x - loc) / beta;
        if (z <= 0) return 0;

        const logPdf = (alpha - 1) * Math.log(z) - z - this.logGamma(alpha) - Math.log(beta);
        return Math.exp(logPdf);
    }

    /**
     * Gamma CDF using series expansion
     */
    gammaCDF(x, alpha, loc, beta) {
        const z = (x - loc) / beta;
        if (z <= 0) return 0;

        return this.lowerIncompleteGamma(alpha, z) / this.gamma(alpha);
    }

    /**
     * Log Gamma function (Stirling approximation)
     */
    logGamma(x) {
        if (x <= 0) return 0;
        return (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI) +
            1 / (12 * x) - 1 / (360 * x * x * x);
    }

    /**
     * Gamma function
     */
    gamma(x) {
        return Math.exp(this.logGamma(x));
    }

    /**
     * Lower incomplete gamma function (series expansion)
     */
    lowerIncompleteGamma(a, x) {
        if (x <= 0) return 0;

        let sum = 0;
        let term = 1 / a;
        sum = term;

        for (let n = 1; n < 100; n++) {
            term *= x / (a + n);
            sum += term;
            if (Math.abs(term) < 1e-10) break;
        }

        return Math.pow(x, a) * Math.exp(-x) * sum;
    }

    /**
     * Create histogram bins with density
     */
    createHistogram(data, bins = 40) {
        const min = Math.min(...data);
        const max = Math.max(...data);
        const binWidth = (max - min) / bins;
        const counts = new Array(bins).fill(0);
        const edges = [];

        for (let i = 0; i <= bins; i++) {
            edges.push(min + i * binWidth);
        }

        for (const val of data) {
            const idx = Math.min(Math.floor((val - min) / binWidth), bins - 1);
            counts[idx]++;
        }

        // Convert to density
        const totalArea = data.length * binWidth;
        const density = counts.map(c => c / totalArea);

        // Bin centers for line overlay
        const centers = edges.slice(0, -1).map((e, i) => (e + edges[i + 1]) / 2);

        return { edges, counts, density, binWidth, centers };
    }
}

// Export for use
window.LinkBudgetCalculator = LinkBudgetCalculator;

