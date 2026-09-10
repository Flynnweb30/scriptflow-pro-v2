export type NetworkState = 'checking' | 'online' | 'degraded' | 'offline';

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
}

type Listener = (snapshot: NetworkSnapshot) => void;

const PROBE_INTERVAL_MS = 5000;
const BANDWIDTH_INTERVAL_MS = 60000;
const PROBE_TIMEOUT_MS = 4500;
const MAX_SAMPLES = 12;
const CONFIRMED_FAILURES = 3;
const BANDWIDTH_ASSET = '/network-probe.bin';

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
    private consecutiveFailures = 0;
    private confirmedOffline = false;
    private samples: number[] = [];
    private outcomes: boolean[] = [];
    private pendingBars: number | null = null;
    private pendingBarCount = 0;
    private peerConnections = new Set<RTCPeerConnection>();
    private peerPollTimer: number | null = null;
    private lowNetworkMode = false;

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

    /** Register an actual WebRTC connection when the calling surface owns one. */
    setLowNetworkMode(enabled: boolean): void {
        if (this.lowNetworkMode === enabled) return;
        this.lowNetworkMode = enabled;
        if (enabled && this.bandwidthInFlight) {
            // The in-flight transfer cannot be safely cancelled without treating it as a
            // failed measurement, so let it finish and suppress future tests.
        }
        this.snapshot = { ...this.snapshot };
        this.emit();
        if (!enabled && !this.hidden && !this.snapshot.liveCallActive) this.scheduleBandwidth();
    }

    isLowNetworkMode(): boolean {
        return this.lowNetworkMode;
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
        if (!this.hidden) this.scheduleActiveLoops(true);
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
        this.probeTimer = window.setTimeout(() => {
            void this.runProbe();
        }, immediate ? 0 : PROBE_INTERVAL_MS);
        this.bandwidthTimer = window.setTimeout(() => {
            if (!this.snapshot.liveCallActive) void this.runBandwidthTest();
            else this.scheduleBandwidth();
        }, BANDWIDTH_INTERVAL_MS);
        if (this.peerConnections.size > 0 || this.snapshot.liveCallActive) this.startPeerPolling();
    }

    private scheduleProbe(): void {
        if (this.hidden) return;
        this.probeTimer = window.setTimeout(() => void this.runProbe(), PROBE_INTERVAL_MS);
    }

    private scheduleBandwidth(): void {
        if (this.hidden) return;
        this.bandwidthTimer = window.setTimeout(() => {
            if (!this.snapshot.liveCallActive) void this.runBandwidthTest();
            else this.scheduleBandwidth();
        }, BANDWIDTH_INTERVAL_MS);
    }

    private handleVisibility = (): void => {
        this.hidden = document.visibilityState === 'hidden';
        if (this.hidden) {
            this.stopLoops();
            return;
        }
        this.scheduleActiveLoops(true);
    };

    private handleOffline = (): void => {
        this.confirmedOffline = true;
        this.consecutiveFailures = CONFIRMED_FAILURES;
        this.setSnapshot({ state: 'offline', bars: 0 });
    };

    private handleOnline = (): void => {
        // Do not increment reconnects here. Recovery is confirmed by a successful probe.
        this.confirmedOffline = true;
        this.consecutiveFailures = 0;
        if (!this.hidden) void this.runProbe();
    };

    private async runProbe(): Promise<void> {
        if (this.hidden || this.probeInFlight) return;
        this.probeInFlight = true;
        const startedAt = performance.now();
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
        try {
            const response = await fetch(`${BANDWIDTH_ASSET}?probe=${Date.now()}-${Math.random().toString(36).slice(2)}`, {
                method: 'GET',
                cache: 'no-store',
                credentials: 'same-origin',
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`Probe returned ${response.status}`);
            // Consume the body so the browser completes the request before timing it.
            // Measure time to first response byte/header completion. Do not download the
            // probe payload on every 5-second jitter sample.
            const rtt = Math.max(0.1, performance.now() - startedAt);
            try { await response.body?.cancel(); } catch { /* ignore stream teardown */ }
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
        this.snapshot = {
            ...this.snapshot,
            state: bars <= 2 ? 'degraded' : 'online',
            bars,
            jitterMs: jitter,
            latencyMs: rtt,
            packetLossPct: packetLoss,
            stabilityPct: stability,
            lastMeasuredAt: Date.now(),
        };
        if (wasConfirmedOffline) {
            this.snapshot = { ...this.snapshot, reconnects: this.snapshot.reconnects + 1 };
        }
        this.emit();
    }

    private recordFailure(): void {
        this.consecutiveFailures += 1;
        this.outcomes = [...this.outcomes, false].slice(-MAX_SAMPLES);
        const confirmed = this.consecutiveFailures >= CONFIRMED_FAILURES;
        if (confirmed) {
            const wasAlreadyOffline = this.confirmedOffline;
            this.confirmedOffline = true;
            this.snapshot = {
                ...this.snapshot,
                state: 'offline',
                bars: 0,
                jitterMs: null,
                latencyMs: null,
                packetLossPct: this.calculatePacketLoss(this.outcomes),
                stabilityPct: this.calculateStability(this.snapshot.jitterMs, this.calculatePacketLoss(this.outcomes)),
                lastMeasuredAt: Date.now(),
            };
            if (!wasAlreadyOffline) this.emit();
        } else {
            const packetLoss = this.calculatePacketLoss(this.outcomes);
            this.snapshot = {
                ...this.snapshot,
                jitterMs: null,
                latencyMs: null,
                packetLossPct: packetLoss,
                stabilityPct: this.calculateStability(null, packetLoss),
            };
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
        const failures = outcomes.filter(ok => !ok).length;
        return (failures / outcomes.length) * 100;
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
        // The requested 4-bar band starts at 70 ms. Measurements below 70 ms are
        // better than the best specified band and are therefore shown at 4 bars.
        return 4;
    }

    private applyHysteresis(nextBars: number): number {
        if (this.snapshot.bars === 0 && this.snapshot.state === 'checking') return nextBars;
        if (nextBars === this.snapshot.bars) {
            this.pendingBars = null;
            this.pendingBarCount = 0;
            return nextBars;
        }
        if (this.pendingBars !== nextBars) {
            this.pendingBars = nextBars;
            this.pendingBarCount = 1;
            return this.snapshot.bars;
        }
        this.pendingBarCount += 1;
        if (this.pendingBarCount >= 2) {
            this.pendingBars = null;
            this.pendingBarCount = 0;
            return nextBars;
        }
        return this.snapshot.bars;
    }

    private async runBandwidthTest(): Promise<void> {
        if (this.hidden || this.bandwidthInFlight || this.snapshot.liveCallActive || this.lowNetworkMode || !navigator.onLine) {
            this.scheduleBandwidth();
            return;
        }
        this.bandwidthInFlight = true;
        const startedAt = performance.now();
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 12000);
        try {
            const response = await fetch(`${BANDWIDTH_ASSET}?bandwidth=${Date.now()}-${Math.random().toString(36).slice(2)}`, {
                method: 'GET',
                cache: 'no-store',
                credentials: 'same-origin',
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`Bandwidth test returned ${response.status}`);
            const body = await response.arrayBuffer();
            const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
            const downloadMbps = (body.byteLength * 8) / elapsedSeconds / 1_000_000;

            // A pure Render Static Site has no upload endpoint. Only populate uploadMbps
            // when the deployment explicitly provides a CORS-enabled upload probe. Never
            // infer or fabricate upload speed from download traffic.
            const uploadUrl = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_NETWORK_UPLOAD_URL;
            let uploadMbps: number | null = null;
            if (uploadUrl && !this.snapshot.liveCallActive && !this.lowNetworkMode) {
                uploadMbps = await this.measureUpload(uploadUrl);
            }

            this.snapshot = { ...this.snapshot, downloadMbps, uploadMbps, lastBandwidthAt: Date.now() };
            this.emit();
        } catch {
            // Bandwidth failures never affect connection bars and never become fake zeros.
            this.snapshot = { ...this.snapshot, downloadMbps: null, uploadMbps: null };
            this.emit();
        } finally {
            window.clearTimeout(timeout);
            this.bandwidthInFlight = false;
            this.scheduleBandwidth();
        }
    }

    private async measureUpload(uploadUrl: string): Promise<number | null> {
        const payload = new Uint8Array(256 * 1024);
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 12000);
        const startedAt = performance.now();
        try {
            const response = await fetch(uploadUrl, {
                method: 'POST',
                body: payload,
                cache: 'no-store',
                mode: 'cors',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/octet-stream' },
            });
            if (!response.ok) return null;
            const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
            return (payload.byteLength * 8) / elapsedSeconds / 1_000_000;
        } catch {
            return null;
        } finally {
            window.clearTimeout(timeout);
        }
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
            } catch {
                // A closed/invalid peer is ignored; application calls are never interrupted.
            }
        }
        const total = received + lost;
        this.snapshot = {
            ...this.snapshot,
            liveCallActive: this.peerConnections.size > 0,
            liveCallAudioLossPct: total > 0 ? (lost / total) * 100 : null,
            liveCallJitterMs: jitterValues.length ? jitterValues.reduce((a, b) => a + b, 0) / jitterValues.length : null,
        };
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
