export type NetworkState = 'checking' | 'online' | 'degraded' | 'offline';
export type SpeedTestState = 'idle' | 'running' | 'complete' | 'failed';

export interface NetworkSnapshot {
    state: NetworkState;
    bars: number;
    jitterMs: number | null;
    latencyMs: number | null;
    packetLossPct: number | null;
    stabilityPct: number | null;
    downloadMbps: number | null;
    uploadMbps: number | null;
    reconnects: number;
    liveCallActive: boolean;
    liveCallAudioLossPct: number | null;
    liveCallJitterMs: number | null;
    lastMeasuredAt: number | null;
    lastBandwidthAt: number | null;
    speedTestState: SpeedTestState;
    speedTestProgress: number;
    speedTestPhase: 'idle' | 'latency' | 'download' | 'upload' | 'calculating';
    speedTestStartedAt: number | null;
    speedTestDurationMs: number | null;
}

type Listener = (snapshot: NetworkSnapshot) => void;

const PROBE_INTERVAL_MS = 5000;
const BANDWIDTH_INTERVAL_MS = 60000;
const PROBE_TIMEOUT_MS = 4500;
const MAX_SAMPLES = 12;
const CONFIRMED_FAILURES = 3;
const SPEED_TEST_MIN_MS = 10000;
const SPEED_TEST_TARGET_MS = 16000;
const SPEED_TEST_MAX_MS = 30000;
const SPEED_TEST_VERY_SLOW_MAX_MS = 45000;
const SPEED_TEST_PHASE_MAX_MS = 14000;
const SPEED_TEST_VERY_SLOW_PHASE_MAX_MS = 20000;
const SPEED_TEST_LATENCY_MS = 2000;
const SPEED_TEST_DOWNLOAD_TARGET_MS = 6000;
const SPEED_TEST_UPLOAD_TARGET_MS = 6000;
const SPEED_TEST_SLOW_MBPS = 5;
const SPEED_TEST_UNSTABLE_CV = 0.18;
const SPEED_TEST_STABLE_CV = 0.10;
const SPEED_TEST_STABLE_WINDOW = 3;
const SPEED_TEST_DOWNLOAD_CHUNK = 5_000_000;
const SPEED_TEST_UPLOAD_CHUNK = 4 * 1024 * 1024;
const BANDWIDTH_ASSET = '/network-probe.bin';
const CLOUDFLARE_DOWNLOAD_URL = 'https://speed.cloudflare.com/__down';
const CLOUDFLARE_UPLOAD_URL = 'https://speed.cloudflare.com/__up';
const SPEED_MONITOR_STORAGE_KEY = 'scriptflow.speed-monitor.enabled';

const initialSnapshot: NetworkSnapshot = {
    state: 'checking',
    bars: 0,
    jitterMs: null,
    latencyMs: null,
    packetLossPct: null,
    stabilityPct: null,
    downloadMbps: null,
    uploadMbps: null,
    reconnects: 0,
    liveCallActive: false,
    liveCallAudioLossPct: null,
    liveCallJitterMs: null,
    lastMeasuredAt: null,
    lastBandwidthAt: null,
    speedTestState: 'idle',
    speedTestProgress: 0,
    speedTestPhase: 'idle',
    speedTestStartedAt: null,
    speedTestDurationMs: null,
};

class NetworkMonitorService {
    private listeners = new Set<Listener>();
    private snapshot: NetworkSnapshot = { ...initialSnapshot };
    private started = false;
    private hidden = document.visibilityState === 'hidden';
    private probeTimer: number | null = null;
    private bandwidthTimer: number | null = null;
    private probeInFlight = false;
    private bandwidthInFlight = false;
    private speedTestInFlight = false;
    private consecutiveFailures = 0;
    private confirmedOffline = false;
    private samples: number[] = [];
    private outcomes: boolean[] = [];
    private pendingBars: number | null = null;
    private pendingBarCount = 0;
    private peerConnections = new Set<RTCPeerConnection>();
    private peerPollTimer: number | null = null;
    private lowNetworkMode = false;
    private speedMonitorEnabled = this.readSpeedMonitorPreference();

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        listener(this.snapshot);
        this.start();
        return () => this.listeners.delete(listener);
    }

    getSnapshot(): NetworkSnapshot {
        return this.snapshot;
    }

    setLiveCallActive(active: boolean): void {
        if (!active) {
            this.snapshot = {
                ...this.snapshot,
                liveCallActive: false,
                liveCallAudioLossPct: null,
                liveCallJitterMs: null,
            };
            this.emit();
            return;
        }
        this.snapshot = { ...this.snapshot, liveCallActive: true };
        this.emit();
        this.startPeerPolling();
    }

    setLowNetworkMode(enabled: boolean): void {
        if (this.lowNetworkMode === enabled) return;
        this.lowNetworkMode = enabled;
        this.snapshot = { ...this.snapshot };
        this.emit();
        if (!enabled && !this.hidden && !this.snapshot.liveCallActive) this.scheduleBandwidth();
    }

    isLowNetworkMode(): boolean {
        return this.lowNetworkMode;
    }

    isSpeedMonitorEnabled(): boolean {
        return this.speedMonitorEnabled;
    }

    setSpeedMonitorEnabled(enabled: boolean): void {
        this.speedMonitorEnabled = enabled;
        try { window.localStorage.setItem(SPEED_MONITOR_STORAGE_KEY, enabled ? '1' : '0'); } catch { /* storage may be blocked */ }
        if (enabled && !this.hidden && !this.snapshot.liveCallActive) this.scheduleBandwidth(1000);
        else if (!enabled && this.bandwidthTimer !== null) {
            window.clearTimeout(this.bandwidthTimer);
            this.bandwidthTimer = null;
        }
        this.emit();
    }

    async runSpeedTest(): Promise<void> {
        if (this.hidden || this.speedTestInFlight || this.snapshot.liveCallActive || this.lowNetworkMode || !navigator.onLine) return;
        this.speedTestInFlight = true;
        const startedAt = performance.now();
        const controller = new AbortController();
        const hardTimeout = window.setTimeout(() => controller.abort(), SPEED_TEST_VERY_SLOW_MAX_MS + 5000);
        try {
            this.updateSpeedTest('running', 0, 'latency', startedAt, null);

            // Phase 1: short latency sample window.
            const latencySamples = await this.measureLatencyWindow(SPEED_TEST_LATENCY_MS, controller.signal);
            const latency = latencySamples.length
                ? latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length
                : null;
            if (latency !== null) this.recordSuccess(latency);

            const elapsedAfterLatency = performance.now() - startedAt;
            const remainingTarget = Math.max(SPEED_TEST_MIN_MS - elapsedAfterLatency, 0);
            this.updateSpeedTest('running', 13, 'download', startedAt, null);

            // Phase 2: download. The test starts with a normal window and extends when
            // samples are unstable or the connection is too slow.
            const download = await this.measureBandwidthPhase('download', SPEED_TEST_DOWNLOAD_TARGET_MS, SPEED_TEST_PHASE_MAX_MS, controller.signal, (p) => {
                const progress = 13 + Math.min(37, p * 37);
                this.updateSpeedTest('running', progress, 'download', startedAt, null);
            });

            if (download !== null) {
                this.snapshot = { ...this.snapshot, downloadMbps: download.mbps };
                this.emit();
            }

            const dynamicUploadStart = Math.max(remainingTarget, SPEED_TEST_TARGET_MS - (performance.now() - startedAt));
            if (dynamicUploadStart > 0) await this.delay(Math.min(dynamicUploadStart, 500), controller.signal);

            this.updateSpeedTest('running', 50, 'upload', startedAt, null);
            const upload = await this.measureBandwidthPhase('upload', SPEED_TEST_UPLOAD_TARGET_MS, SPEED_TEST_PHASE_MAX_MS, controller.signal, (p) => {
                const progress = 50 + Math.min(40, p * 40);
                this.updateSpeedTest('running', progress, 'upload', startedAt, null);
            });

            if (upload !== null) {
                this.snapshot = { ...this.snapshot, uploadMbps: upload.mbps };
                this.emit();
            }

            // Slow links are allowed a longer final stabilization window, but never run
            // indefinitely. The normal path finishes around 10–16 seconds.
            const currentDownload = download?.mbps ?? 0;
            const currentUpload = upload?.mbps ?? 0;
            const verySlow = Math.max(currentDownload, currentUpload) > 0 && Math.max(currentDownload, currentUpload) < SPEED_TEST_SLOW_MBPS;
            const unstable = this.lastPhaseWasUnstable;
            const desiredMax = verySlow ? SPEED_TEST_VERY_SLOW_MAX_MS : unstable ? SPEED_TEST_MAX_MS : SPEED_TEST_TARGET_MS;
            const elapsed = performance.now() - startedAt;
            if (elapsed < desiredMax && (verySlow || unstable)) {
                const extraMs = Math.min(desiredMax - elapsed, 5000);
                await this.delay(extraMs, controller.signal);
            }

            this.updateSpeedTest('running', 93, 'calculating', startedAt, null);
            await this.delay(150, controller.signal);

            const duration = performance.now() - startedAt;
            this.snapshot = {
                ...this.snapshot,
                lastBandwidthAt: Date.now(),
                speedTestState: 'complete',
                speedTestProgress: 100,
                speedTestPhase: 'idle',
                speedTestStartedAt: startedAt,
                speedTestDurationMs: duration,
            };
            this.emit();
        } catch {
            const duration = performance.now() - startedAt;
            this.snapshot = {
                ...this.snapshot,
                speedTestState: 'failed',
                speedTestProgress: 0,
                speedTestPhase: 'idle',
                speedTestStartedAt: startedAt,
                speedTestDurationMs: duration,
            };
            this.emit();
        } finally {
            window.clearTimeout(hardTimeout);
            this.speedTestInFlight = false;
            if (!this.hidden && this.speedMonitorEnabled && !this.snapshot.liveCallActive) this.scheduleBandwidth();
        }
    }

    registerPeerConnection(peer: RTCPeerConnection): () => void {
        this.peerConnections.add(peer);
        this.snapshot = { ...this.snapshot, liveCallActive: true };
        this.emit();
        this.startPeerPolling();
        return () => {
            this.peerConnections.delete(peer);
            if (this.peerConnections.size === 0) this.setLiveCallActive(false);
        };
    }

    private readSpeedMonitorPreference(): boolean {
        try { return window.localStorage.getItem(SPEED_MONITOR_STORAGE_KEY) === '1'; } catch { return false; }
    }

    private start(): void {
        if (this.started || typeof window === 'undefined') return;
        this.started = true;
        if (!navigator.onLine) {
            this.confirmedOffline = true;
            this.snapshot = { ...this.snapshot, state: 'offline', bars: 0 };
        }
        window.addEventListener('online', this.handleOnline);
        window.addEventListener('offline', this.handleOffline);
        document.addEventListener('visibilitychange', this.handleVisibility);
        if (!this.hidden) {
            this.scheduleActiveLoops(true);
            // One automatic speed test per app session. Continuous testing remains opt-in.
            window.setTimeout(() => void this.runSpeedTest(), 700);
        }
    }

    private stopLoops(): void {
        if (this.probeTimer !== null) window.clearTimeout(this.probeTimer);
        if (this.bandwidthTimer !== null) window.clearTimeout(this.bandwidthTimer);
        if (this.peerPollTimer !== null) window.clearTimeout(this.peerPollTimer);
        this.probeTimer = null;
        this.bandwidthTimer = null;
        this.peerPollTimer = null;
    }

    private scheduleActiveLoops(immediate = false): void {
        this.stopLoops();
        if (this.hidden) return;
        this.probeTimer = window.setTimeout(() => void this.runProbe(), immediate ? 0 : PROBE_INTERVAL_MS);
        if (this.speedMonitorEnabled) this.scheduleBandwidth(BANDWIDTH_INTERVAL_MS);
        if (this.peerConnections.size > 0 || this.snapshot.liveCallActive) this.startPeerPolling();
    }

    private scheduleProbe(): void {
        if (this.hidden) return;
        this.probeTimer = window.setTimeout(() => void this.runProbe(), PROBE_INTERVAL_MS);
    }

    private scheduleBandwidth(delayMs = BANDWIDTH_INTERVAL_MS): void {
        if (this.hidden || !this.speedMonitorEnabled) return;
        if (this.bandwidthTimer !== null) window.clearTimeout(this.bandwidthTimer);
        this.bandwidthTimer = window.setTimeout(() => {
            this.bandwidthTimer = null;
            if (!this.snapshot.liveCallActive) void this.runSpeedTest();
            else this.scheduleBandwidth();
        }, delayMs);
    }

    private handleVisibility = (): void => {
        this.hidden = document.visibilityState === 'hidden';
        if (this.hidden) {
            this.stopLoops();
            return;
        }
        this.scheduleActiveLoops(true);
        if (!this.snapshot.lastBandwidthAt) window.setTimeout(() => void this.runSpeedTest(), 500);
    };

    private handleOffline = (): void => {
        this.confirmedOffline = true;
        this.consecutiveFailures = CONFIRMED_FAILURES;
        this.setSnapshot({ state: 'offline', bars: 0 });
    };

    private handleOnline = (): void => {
        this.confirmedOffline = true;
        this.consecutiveFailures = 0;
        if (!this.hidden) {
            void this.runProbe();
            window.setTimeout(() => void this.runSpeedTest(), 500);
        }
    };

    private async runProbe(): Promise<void> {
        if (this.hidden || this.probeInFlight) return;
        this.probeInFlight = true;
        const startedAt = performance.now();
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
        try {
            const response = await fetch(`${BANDWIDTH_ASSET}?probe=${Date.now()}-${Math.random().toString(36).slice(2)}`, {
                method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
            });
            if (!response.ok) throw new Error(`Probe returned ${response.status}`);
            const rtt = Math.max(0.1, performance.now() - startedAt);
            try { await response.body?.cancel(); } catch { /* ignore */ }
            this.recordSuccess(rtt);
        } catch {
            this.recordFailure();
        } finally {
            window.clearTimeout(timeout);
            this.probeInFlight = false;
            this.scheduleProbe();
        }
    }

    private recordSuccess(rtt: number): void {
        const wasConfirmedOffline = this.confirmedOffline;
        this.consecutiveFailures = 0;
        this.confirmedOffline = false;
        this.samples = [...this.samples, rtt].slice(-MAX_SAMPLES);
        this.outcomes = [...this.outcomes, true].slice(-MAX_SAMPLES);
        const jitter = this.calculateJitter(this.samples);
        const packetLoss = this.calculatePacketLoss(this.outcomes);
        const rawBars = this.barsForJitter(jitter);
        const bars = this.applyHysteresis(rawBars);
        const stability = this.calculateStability(jitter, packetLoss);
        this.snapshot = { ...this.snapshot, state: bars <= 2 ? 'degraded' : 'online', bars, jitterMs: jitter, latencyMs: rtt, packetLossPct: packetLoss, stabilityPct: stability, lastMeasuredAt: Date.now() };
        if (wasConfirmedOffline) this.snapshot = { ...this.snapshot, reconnects: this.snapshot.reconnects + 1 };
        this.emit();
    }

    private recordFailure(): void {
        this.consecutiveFailures += 1;
        this.outcomes = [...this.outcomes, false].slice(-MAX_SAMPLES);
        const confirmed = this.consecutiveFailures >= CONFIRMED_FAILURES;
        if (confirmed) {
            const wasAlreadyOffline = this.confirmedOffline;
            this.confirmedOffline = true;
            this.snapshot = { ...this.snapshot, state: 'offline', bars: 0, jitterMs: null, latencyMs: null, packetLossPct: this.calculatePacketLoss(this.outcomes), stabilityPct: this.calculateStability(this.snapshot.jitterMs, this.calculatePacketLoss(this.outcomes)), lastMeasuredAt: Date.now() };
            if (!wasAlreadyOffline) this.emit();
        } else {
            const packetLoss = this.calculatePacketLoss(this.outcomes);
            this.snapshot = { ...this.snapshot, jitterMs: null, latencyMs: null, packetLossPct: packetLoss, stabilityPct: this.calculateStability(null, packetLoss) };
            this.emit();
        }
    }

    private calculateJitter(samples: number[]): number | null {
        if (samples.length < 2) return null;
        let total = 0;
        for (let i = 1; i < samples.length; i += 1) total += Math.abs(samples[i] - samples[i - 1]);
        return total / (samples.length - 1);
    }

    private calculatePacketLoss(outcomes: boolean[]): number | null {
        if (!outcomes.length) return null;
        return (outcomes.filter(ok => !ok).length / outcomes.length) * 100;
    }

    private calculateStability(jitter: number | null, loss: number | null): number | null {
        if (jitter === null && loss === null) return null;
        const jitterPenalty = jitter === null ? 0 : Math.min(100, jitter / 4);
        const lossPenalty = loss === null ? 0 : Math.min(100, loss * 2);
        return Math.max(0, Math.min(100, 100 - jitterPenalty - lossPenalty));
    }

    private barsForJitter(jitter: number | null): number {
        if (this.confirmedOffline || !navigator.onLine) return 0;
        if (jitter === null) return 0;
        if (jitter >= 401) return 1;
        if (jitter >= 291) return 2;
        if (jitter >= 181) return 3;
        return 4;
    }

    private applyHysteresis(nextBars: number): number {
        if (this.snapshot.bars === 0 && this.snapshot.state === 'checking') return nextBars;
        if (nextBars === this.snapshot.bars) { this.pendingBars = null; this.pendingBarCount = 0; return nextBars; }
        if (this.pendingBars !== nextBars) { this.pendingBars = nextBars; this.pendingBarCount = 1; return this.snapshot.bars; }
        this.pendingBarCount += 1;
        if (this.pendingBarCount >= 2) { this.pendingBars = null; this.pendingBarCount = 0; return nextBars; }
        return this.snapshot.bars;
    }

    private async measureLatencyWindow(durationMs: number, signal: AbortSignal): Promise<number[]> {
        const values: number[] = [];
        const deadline = performance.now() + durationMs;
        while (performance.now() < deadline && values.length < 8) {
            const started = performance.now();
            try {
                const response = await fetch(`${CLOUDFLARE_DOWNLOAD_URL}?bytes=1000&latency=${Date.now()}-${Math.random().toString(36).slice(2)}`, { cache: 'no-store', signal });
                if (!response.ok) throw new Error('latency request failed');
                await response.arrayBuffer();
                values.push(performance.now() - started);
            } catch {
                if (signal.aborted) throw new Error('speed test aborted');
            }
        }
        return values;
    }

    private lastPhaseWasUnstable = false;

    private async measureBandwidthPhase(
        phase: 'download' | 'upload',
        normalMs: number,
        maxMs: number,
        signal: AbortSignal,
        onProgress: (progress: number) => void,
    ): Promise<{ mbps: number; bytes: number } | null> {
        const started = performance.now();
        const samples: number[] = [];
        let bytes = 0;
        let lastProgress = 0;
        this.lastPhaseWasUnstable = false;
        let hardDeadline = started + maxMs;
        const normalDeadline = started + normalMs;

        while (performance.now() < hardDeadline) {
            const value = phase === 'download'
                ? await this.measureDownloadChunk(signal)
                : await this.measureUploadChunk(signal);
            if (value === null) break;
            samples.push(value.mbps);
            bytes += value.bytes;
            const elapsed = Math.max((performance.now() - started) / 1000, 0.001);
            const progress = Math.min(1, elapsed / (normalMs / 1000));
            if (progress > lastProgress) { lastProgress = progress; onProgress(progress); }

            const stable = this.isStable(samples);
            const unstable = samples.length >= SPEED_TEST_STABLE_WINDOW && this.coefficientOfVariation(samples) >= SPEED_TEST_UNSTABLE_CV;
            const verySlow = samples.length > 0 && Math.max(...samples) < SPEED_TEST_SLOW_MBPS;
            if (verySlow) hardDeadline = Math.min(started + SPEED_TEST_VERY_SLOW_PHASE_MAX_MS, started + SPEED_TEST_VERY_SLOW_MAX_MS);
            this.lastPhaseWasUnstable = unstable;

            // Stable results finish early around 10–15 seconds total. Unstable/slow
            // links continue sampling until their adaptive ceiling.
            if (performance.now() >= normalDeadline && stable && !verySlow && !unstable) break;
            if (performance.now() >= normalDeadline && !unstable && !verySlow && samples.length >= 4) break;
            if (verySlow && performance.now() < hardDeadline) continue;
            if (unstable && performance.now() < hardDeadline) continue;
        }

        if (!samples.length) return null;
        // Throughput is the median of the per-request rates, which avoids one short
        // CDN/TCP ramp-up request dominating the final value.
        const sorted = [...samples].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
        const totalMbps = (bytes * 8) / Math.max((performance.now() - started) / 1000, 0.001) / 1_000_000;
        return { mbps: Math.max(0, Math.min(median, totalMbps * 1.5)), bytes };
    }

    private async measureDownloadChunk(signal: AbortSignal): Promise<{ mbps: number; bytes: number } | null> {
        const started = performance.now();
        try {
            const response = await fetch(`${CLOUDFLARE_DOWNLOAD_URL}?bytes=${SPEED_TEST_DOWNLOAD_CHUNK}&t=${Date.now()}-${Math.random().toString(36).slice(2)}`, { cache: 'no-store', signal });
            if (!response.ok) return null;
            const body = await response.arrayBuffer();
            const seconds = Math.max((performance.now() - started) / 1000, 0.001);
            return { mbps: (body.byteLength * 8) / seconds / 1_000_000, bytes: body.byteLength };
        } catch {
            if (signal.aborted) throw new Error('speed test aborted');
            return null;
        }
    }

    private async measureUploadChunk(signal: AbortSignal): Promise<{ mbps: number; bytes: number } | null> {
        const payload = new Uint8Array(SPEED_TEST_UPLOAD_CHUNK);
        // Sparse pseudo-random bytes prevent an intermediary from compressing a zero-filled payload.
        for (let i = 0; i < payload.length; i += 4096) payload[i] = Math.floor(Math.random() * 256);
        const started = performance.now();
        try {
            const response = await fetch(`${CLOUDFLARE_UPLOAD_URL}?t=${Date.now()}-${Math.random().toString(36).slice(2)}`, {
                method: 'POST', body: payload, cache: 'no-store', mode: 'cors', signal,
                headers: { 'Content-Type': 'application/octet-stream' },
            });
            if (!response.ok) return null;
            const seconds = Math.max((performance.now() - started) / 1000, 0.001);
            return { mbps: (payload.byteLength * 8) / seconds / 1_000_000, bytes: payload.byteLength };
        } catch {
            if (signal.aborted) throw new Error('speed test aborted');
            return null;
        }
    }

    private coefficientOfVariation(values: number[]): number {
        if (values.length < 2) return 0;
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        if (!mean) return 1;
        const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
        return Math.sqrt(variance) / mean;
    }

    private isStable(values: number[]): boolean {
        if (values.length < SPEED_TEST_STABLE_WINDOW) return false;
        return this.coefficientOfVariation(values.slice(-SPEED_TEST_STABLE_WINDOW)) <= SPEED_TEST_STABLE_CV;
    }

    private updateSpeedTest(state: SpeedTestState, progress: number, phase: NetworkSnapshot['speedTestPhase'], startedAt: number, duration: number | null): void {
        this.snapshot = { ...this.snapshot, speedTestState: state, speedTestProgress: Math.max(0, Math.min(100, progress)), speedTestPhase: phase, speedTestStartedAt: startedAt, speedTestDurationMs: duration };
        this.emit();
    }

    private delay(ms: number, signal: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            if (signal.aborted) { reject(new Error('speed test aborted')); return; }
            const timer = window.setTimeout(resolve, ms);
            signal.addEventListener('abort', () => { window.clearTimeout(timer); reject(new Error('speed test aborted')); }, { once: true });
        });
    }

    private startPeerPolling(): void {
        if (this.hidden || this.peerPollTimer !== null) return;
        this.peerPollTimer = window.setTimeout(() => void this.pollPeerStats(), 1000);
    }

    private async pollPeerStats(): Promise<void> {
        this.peerPollTimer = null;
        if (this.hidden || this.peerConnections.size === 0) return;
        let received = 0;
        let lost = 0;
        const jitterValues: number[] = [];
        for (const peer of this.peerConnections) {
            try {
                const stats = await peer.getStats();
                stats.forEach((report) => {
                    if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                        received += Number(report.packetsReceived || 0);
                        lost += Number(report.packetsLost || 0);
                        if (Number.isFinite(report.jitter)) jitterValues.push(Number(report.jitter) * 1000);
                    }
                });
            } catch { /* ignore */ }
        }
        const total = received + lost;
        this.snapshot = { ...this.snapshot, liveCallActive: this.peerConnections.size > 0, liveCallAudioLossPct: total > 0 ? (lost / total) * 100 : null, liveCallJitterMs: jitterValues.length ? jitterValues.reduce((a, b) => a + b, 0) / jitterValues.length : null };
        this.emit();
        this.startPeerPolling();
    }

    private setSnapshot(patch: Partial<NetworkSnapshot>): void {
        this.snapshot = { ...this.snapshot, ...patch };
        this.emit();
    }

    private emit(): void {
        for (const listener of this.listeners) listener(this.snapshot);
    }
}

export const NetworkMonitor = new NetworkMonitorService();
