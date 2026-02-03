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

        // Earth station vector
        const esX = Math.cos(latEs);
        const esY = 0;
        const esZ = Math.sin(latEs);

        const thetaArray = [];
        const visibleTheta = [];

        // Propagate orbit
        for (let i = 0; i < numSteps; i++) {
            const t = i * stepS;
            const M = n * t;
            const Omega = raanRate * t;
            const OmegaEff = Omega - we * t + startLon;

            // Satellite unit vector
            const satX = Math.cos(OmegaEff) * Math.cos(M) - Math.sin(OmegaEff) * Math.sin(M) * Math.cos(inc);
            const satY = Math.sin(OmegaEff) * Math.cos(M) + Math.cos(OmegaEff) * Math.sin(M) * Math.cos(inc);
            const satZ = Math.sin(inc) * Math.sin(M);

            // Dot product
            const cosGamma = satX * esX + satY * esY + satZ * esZ;

            // Distance and elevation
            const d = Math.sqrt(this.Re * this.Re + rOrbit * rOrbit - 2 * this.Re * rOrbit * cosGamma);
            const sinTheta = (rOrbit * cosGamma - this.Re) / d;
            const thetaRad = Math.asin(Math.max(-1, Math.min(1, sinTheta)));

            thetaArray.push(thetaRad);

            if (thetaRad >= thetaMinRad) {
                visibleTheta.push(thetaRad * 180 / Math.PI);
            }
        }

        // Extract contact durations
        const contactDurations = [];
        let inContact = false;
        let contactStart = 0;

        for (let i = 0; i < thetaArray.length; i++) {
            const visible = thetaArray[i] >= thetaMinRad;
            if (visible && !inContact) {
                inContact = true;
                contactStart = i;
            } else if (!visible && inContact) {
                inContact = false;
                contactDurations.push((i - contactStart) * stepS);
            }
        }

        // Fit gamma distribution to visible elevation angles
        const gammaParams = this.fitGamma(visibleTheta);

        // Generate PDF and CDF data
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
            }
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

