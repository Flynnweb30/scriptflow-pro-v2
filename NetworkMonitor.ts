export type ConnectionQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'lost' | 'measuring';

export interface NetworkMetrics {
    bars: 0 | 1 | 2 | 3 | 4;
    quality: ConnectionQuality;
    jitterMs: number | null;
    rttMs: number | null;
    packetLossPct: number | null;
    stabilityPct: number | null;
    downloadMbps: number | null;
    uploadMbps: number | null;
    reconnects: number;
    online: boolean;
    bandwidthStatus: 'idle' | 'testing' | 'unavailable';
    lastUpdated: number | null;
}

type Listener = (metrics: NetworkMetrics) => void;

const INITIAL: NetworkMetrics = {
    bars: 4,
    quality: 'measuring',
    jitterMs: null,
    rttMs: null,
    packetLossPct: null,
    stabilityPct: null,
    downloadMbps: null,
    uploadMbps: null,
    reconnects: 0,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    bandwidthStatus: 'idle',
    lastUpdated: null,
};

const PROBE_INTERVAL_MS = 5000;
const BANDWIDTH_INTERVAL_MS = 60000;
const FAILURE_CONFIRMATION_COUNT = 2;
const SAMPLE_WINDOW = 12;
const DOWNLOAD_BYTES = 192 * 1024;
const UPLOAD_BYTES = 96 * 1024;

class NetworkMonitor {
    private listeners = new Set<Listener>();
    private metrics: NetworkMetrics = { ...INITIAL };
    private probeTimer: number | null = null;
    private bandwidthTimer: number | null = null;
    private probeInFlight = false;
    private bandwidthInFlight = false;
    private hidden = document.visibilityState === 'hidden';
    private consecutiveFailures = 0;
    private confirmedLost = !navigator.onLine;
    private rttSamples: number[] = [];
    private lossSamples: boolean[] = [];
    private started = false;
    private lastBandwidthAt = 0;

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        listener(this.metrics);
        this.ensureStarted();
        return () => this.listeners.delete(listener);
    }

    getSnapshot(): NetworkMetrics { return this.metrics; }

    private ensureStarted() {
        if (this.started || typeof window === 'undefined') return;
        this.started = true;
        window.addEventListener('online', this.handleOnline);
        window.addEventListener('offline', this.handleOffline);
        document.addEventListener('visibilitychange', this.handleVisibility);
        this.scheduleProbe(0);
        this.scheduleBandwidth(BANDWIDTH_INTERVAL_MS);
    }

    private emit(patch: Partial<NetworkMetrics>) {
        this.metrics = { ...this.metrics, ...patch };
        this.listeners.forEach(listener => listener(this.metrics));
    }

    private scheduleProbe(delay = PROBE_INTERVAL_MS) {
        if (this.probeTimer !== null) window.clearTimeout(this.probeTimer);
        this.probeTimer = window.setTimeout(() => {
            this.probeTimer = null;
            void this.runProbe();
        }, delay);
    }

    private scheduleBandwidth(delay = BANDWIDTH_INTERVAL_MS) {
        if (this.bandwidthTimer !== null) window.clearTimeout(this.bandwidthTimer);
        this.bandwidthTimer = window.setTimeout(() => {
            this.bandwidthTimer = null;
            void this.runBandwidthTest();
        }, delay);
    }

    private handleOnline = () => {
        this.consecutiveFailures = 0;
        this.scheduleProbe(0);
    };

    private handleOffline = () => {
        this.confirmedLost = true;
        this.consecutiveFailures = FAILURE_CONFIRMATION_COUNT;
        this.emit({
            bars: 0,
            quality: 'lost',
            online: false,
            packetLossPct: this.lossSamples.length ? this.calculateLoss() : 100,
            stabilityPct: 0,
            lastUpdated: Date.now(),
        });
    };

    private handleVisibility = () => {
        this.hidden = document.visibilityState === 'hidden';
        if (this.hidden) {
            if (this.bandwidthTimer !== null) window.clearTimeout(this.bandwidthTimer);
            this.bandwidthTimer = null;
            return;
        }
        this.scheduleProbe(0);
        this.scheduleBandwidth(Math.max(1000, BANDWIDTH_INTERVAL_MS - (Date.now() - this.lastBandwidthAt)));
    };

    private calculateJitter(): number | null {
        if (this.rttSamples.length < 2) return null;
        const diffs: number[] = [];
        for (let i = 1; i < this.rttSamples.length; i += 1) {
            diffs.push(Math.abs(this.rttSamples[i] - this.rttSamples[i - 1]));
        }
        return diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
    }

    private calculateLoss(): number | null {
        if (!this.lossSamples.length) return null;
        const lost = this.lossSamples.filter(Boolean).length;
        return Number(((lost / this.lossSamples.length) * 100).toFixed(1));
    }

    private qualityFromMeasurements(jitter: number | null, rtt: number | null, loss: number | null): Pick<NetworkMetrics, 'bars' | 'quality' | 'stabilityPct'> {
        if (this.confirmedLost || !navigator.onLine) return { bars: 0, quality: 'lost', stabilityPct: 0 };
        if (jitter === null || rtt === null || loss === null) return { bars: 4, quality: 'measuring', stabilityPct: null };

        // Jitter is deliberately the primary quality signal. RTT and loss only
        // refine the result; neither can manufacture a better jitter reading.
        let bars: 4 | 3 | 2 | 1;
        if (jitter <= 20 && loss < 1 && rtt <= 150) bars = 4;
        else if (jitter <= 40 && loss < 2.5 && rtt <= 220) bars = 3;
        else if (jitter <= 80 && loss < 5 && rtt <= 350) bars = 2;
        else bars = 1;

        const stability = Math.max(0, Math.min(100,
            100 - (Math.min(jitter, 150) / 150) * 70 - Math.min(loss, 20) * 1.5
        ));
        const quality = bars === 4 ? 'excellent' : bars === 3 ? 'good' : bars === 2 ? 'fair' : 'poor';
        return { bars, quality, stabilityPct: Number(stability.toFixed(0)) };
    }

    private async runProbe() {
        if (this.hidden || this.probeInFlight) {
            this.scheduleProbe(PROBE_INTERVAL_MS);
            return;
        }
        this.probeInFlight = true;
        const startedAt = performance.now();
        let success = false;
        try {
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 3500);
            const response = await fetch(`/api/network/ping?ts=${Date.now()}`, {
                method: 'GET',
                cache: 'no-store',
                credentials: 'same-origin',
                signal: controller.signal,
                headers: { 'Cache-Control': 'no-cache' },
            });
            window.clearTimeout(timeout);
            success = response.ok;
        } catch {
            success = false;
        } finally {
            this.probeInFlight = false;
        }

        const rtt = performance.now() - startedAt;
        this.lossSamples.push(!success);
        if (this.lossSamples.length > SAMPLE_WINDOW) this.lossSamples.shift();

        if (success) {
            this.consecutiveFailures = 0;
            if (this.confirmedLost) {
                this.metrics.reconnects += 1;
                this.confirmedLost = false;
            }
            this.rttSamples.push(Number(rtt.toFixed(1)));
            if (this.rttSamples.length > SAMPLE_WINDOW) this.rttSamples.shift();
            const jitter = this.calculateJitter();
            const loss = this.calculateLoss();
            const quality = this.qualityFromMeasurements(jitter, rtt, loss);
            this.emit({
                ...quality,
                jitterMs: jitter === null ? null : Number(jitter.toFixed(1)),
                rttMs: Number(rtt.toFixed(1)),
                packetLossPct: loss,
                online: true,
                lastUpdated: Date.now(),
            });
        } else {
            this.consecutiveFailures += 1;
            if (this.consecutiveFailures >= FAILURE_CONFIRMATION_COUNT) {
                this.confirmedLost = true;
                this.emit({
                    bars: 0,
                    quality: 'lost',
                    online: false,
                    packetLossPct: this.calculateLoss(),
                    stabilityPct: 0,
                    lastUpdated: Date.now(),
                });
            } else {
                this.emit({
                    packetLossPct: this.calculateLoss(),
                    lastUpdated: Date.now(),
                });
            }
        }

        this.scheduleProbe(PROBE_INTERVAL_MS);
    }

    private isLiveMediaActive(): boolean {
        if (typeof document === 'undefined') return false;
        return Array.from(document.querySelectorAll('audio,video')).some(media => {
            const element = media as HTMLMediaElement;
            return !element.paused && !element.ended && element.readyState >= 2;
        });
    }

    private async runBandwidthTest() {
        if (this.hidden || this.bandwidthInFlight || this.isLiveMediaActive() || !navigator.onLine) {
            this.scheduleBandwidth(BANDWIDTH_INTERVAL_MS);
            return;
        }
        this.bandwidthInFlight = true;
        this.lastBandwidthAt = Date.now();
        this.emit({ bandwidthStatus: 'testing' });
        try {
            const downloadStart = performance.now();
            const downloadResponse = await fetch(`/api/network/download?bytes=${DOWNLOAD_BYTES}&ts=${Date.now()}`, {
                cache: 'no-store', credentials: 'same-origin',
            });
            if (!downloadResponse.ok) throw new Error('Download test failed');
            await downloadResponse.arrayBuffer();
            const downloadSeconds = Math.max((performance.now() - downloadStart) / 1000, 0.001);
            const downloadMbps = (DOWNLOAD_BYTES * 8) / downloadSeconds / 1_000_000;

            if (this.isLiveMediaActive()) throw new Error('Bandwidth test deferred for live media');

            const uploadPayload = new Uint8Array(UPLOAD_BYTES);
            const uploadStart = performance.now();
            const uploadResponse = await fetch(`/api/network/upload?ts=${Date.now()}`, {
                method: 'POST', body: uploadPayload, cache: 'no-store', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/octet-stream' },
            });
            if (!uploadResponse.ok) throw new Error('Upload test failed');
            const uploadSeconds = Math.max((performance.now() - uploadStart) / 1000, 0.001);
            const uploadMbps = (UPLOAD_BYTES * 8) / uploadSeconds / 1_000_000;
            this.emit({
                downloadMbps: Number(downloadMbps.toFixed(2)),
                uploadMbps: Number(uploadMbps.toFixed(2)),
                bandwidthStatus: 'idle',
            });
        } catch {
            this.emit({ bandwidthStatus: 'unavailable', downloadMbps: null, uploadMbps: null });
        } finally {
            this.bandwidthInFlight = false;
            this.scheduleBandwidth(BANDWIDTH_INTERVAL_MS);
        }
    }
}

export const networkMonitor = new NetworkMonitor();
