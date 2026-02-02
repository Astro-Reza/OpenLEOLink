/**
 * Client-Side Link Budget Calculator
 * Monte Carlo simulation for LEO satellite link budget analysis
 */

class LinkBudgetCalculator {
    constructor() {
        this.Re = 6371.0; // Earth Radius (km)
        this.nSamples = 30000; // Reduced for client performance
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
     * Create histogram bins
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

        return { edges, counts, density, binWidth };
    }
}

// Export for use
window.LinkBudgetCalculator = LinkBudgetCalculator;
