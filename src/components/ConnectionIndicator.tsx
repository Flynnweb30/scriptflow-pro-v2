import React, { useEffect, useState } from 'react';
import { NetworkMonitor, NetworkSnapshot } from '../services/NetworkMonitorService';

const metric = (value: number | null, unit: string) =>
    value === null || !Number.isFinite(value) ? 'unknown' : `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
const pct = (value: number | null) =>
    value === null || !Number.isFinite(value) ? 'N/A' : `${value.toFixed(1)}%`;

export const ConnectionIndicator: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
    const [snapshot, setSnapshot] = useState<NetworkSnapshot>(NetworkMonitor.getSnapshot());
    const [open, setOpen] = useState(false);

    useEffect(() => NetworkMonitor.subscribe(setSnapshot), []);

    const label = snapshot.state === 'checking'
        ? 'Checking connection…'
        : snapshot.state === 'offline'
            ? 'Connection: Offline'
            : snapshot.state === 'degraded'
                ? 'Connection: Degraded'
                : 'Connection: Good';
    const barClass = snapshot.state === 'offline'
        ? 'offline'
        : snapshot.state === 'degraded'
            ? 'degraded'
            : snapshot.state === 'checking'
                ? 'checking'
                : 'online';
    const bandwidth = snapshot.downloadMbps !== null
        ? `${metric(snapshot.downloadMbps, 'Mbps')}${snapshot.uploadMbps !== null ? ` / ${metric(snapshot.uploadMbps, 'Mbps')}` : ''}`
        : 'unknown';
    const callAudio = snapshot.liveCallActive
        ? `${pct(snapshot.liveCallAudioLossPct)} loss • ${metric(snapshot.liveCallJitterMs, 'ms')} jitter • ${metric(snapshot.latencyMs, 'ms')} round trip`
        : 'N/A';

    return (
        <div
            className={`connection-indicator ${compact ? 'connection-indicator--compact' : ''}`}
            onMouseLeave={() => setOpen(false)}
        >
            <button
                type="button"
                className={`connection-indicator__button ${barClass}`}
                onClick={() => setOpen(v => !v)}
                onMouseEnter={() => setOpen(true)}
                aria-label={`Internet connection: ${label}`}
                title={label}
            >
                <span className="connection-bars" aria-hidden="true">
                    {[1, 2, 3, 4].map(bar => <span key={bar} className={snapshot.bars >= bar ? 'active' : ''} />)}
                </span>
                {!compact && <span className="connection-indicator__label">{label}</span>}
            </button>

            {open && (
                <div className="connection-popover" role="dialog" aria-label="Connection diagnostics">
                    <div className="connection-popover__header">
                        <strong>{label}</strong>
                        <span className={`connection-state-dot ${barClass}`} />
                    </div>
                    <div className="connection-popover__summary">
                        Round trip {metric(snapshot.latencyMs, 'ms')} • Bandwidth {bandwidth}
                    </div>
                    <div className="connection-popover__call">
                        Call audio: {callAudio}
                    </div>
                    <div className="connection-popover__reconnects">
                        Reconnects since page load: {snapshot.reconnects}
                    </div>
                    <div className="connection-popover__detail-grid">
                        <span>Jitter</span><strong>{metric(snapshot.jitterMs, 'ms')}</strong>
                        <span>Packet loss</span><strong>{pct(snapshot.packetLossPct)}</strong>
                        <span>Stability</span><strong>{pct(snapshot.stabilityPct)}</strong>
                    </div>
                </div>
            )}
        </div>
    );
};
