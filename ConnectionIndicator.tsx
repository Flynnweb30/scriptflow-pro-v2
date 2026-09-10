import React, { useEffect, useState } from 'react';
import { NetworkMetrics, networkMonitor } from '../services/NetworkMonitor';

const formatMetric = (value: number | null, suffix = '') => value === null ? 'Unavailable' : `${value}${suffix}`;

export const ConnectionIndicator: React.FC = () => {
    const [metrics, setMetrics] = useState<NetworkMetrics>(networkMonitor.getSnapshot());
    const [open, setOpen] = useState(false);

    useEffect(() => networkMonitor.subscribe(setMetrics), []);

    const color = metrics.bars === 0 ? '#ef4444' : metrics.bars === 1 ? '#ef4444' : metrics.bars === 2 ? '#f59e0b' : '#22c55e';
    const label = metrics.quality === 'lost' ? 'Connection Lost' : metrics.quality === 'measuring' ? 'Measuring…' : metrics.quality[0].toUpperCase() + metrics.quality.slice(1);

    return (
        <div className="connection-indicator-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
            <button
                type="button"
                className="connection-indicator"
                aria-label={`Internet connection: ${label}`}
                aria-expanded={open}
                onClick={() => setOpen(value => !value)}
            >
                <span className="signal-bars" aria-hidden="true">
                    {[1, 2, 3, 4].map(level => (
                        <span key={level} className={`signal-bar ${level <= metrics.bars ? 'active' : ''}`} style={{ height: `${6 + level * 3}px`, background: level <= metrics.bars ? color : 'rgba(148,163,184,.22)' }} />
                    ))}
                </span>
                <span className="connection-label">{label}</span>
                <span className="connection-dot" style={{ background: color }} />
            </button>

            {open && (
                <div className="connection-tooltip" role="tooltip">
                    <div className="connection-tooltip-title">Live connection quality</div>
                    <div className="connection-metric"><span>Jitter</span><strong>{formatMetric(metrics.jitterMs, ' ms')}</strong></div>
                    <div className="connection-metric"><span>Round-trip</span><strong>{formatMetric(metrics.rttMs, ' ms')}</strong></div>
                    <div className="connection-metric"><span>Packet loss</span><strong>{formatMetric(metrics.packetLossPct, '%')}</strong></div>
                    <div className="connection-metric"><span>Stability</span><strong>{formatMetric(metrics.stabilityPct, '%')}</strong></div>
                    <div className="connection-metric"><span>Download</span><strong>{metrics.bandwidthStatus === 'testing' ? 'Testing…' : formatMetric(metrics.downloadMbps, ' Mbps')}</strong></div>
                    <div className="connection-metric"><span>Upload</span><strong>{metrics.bandwidthStatus === 'testing' ? 'Testing…' : formatMetric(metrics.uploadMbps, ' Mbps')}</strong></div>
                    <div className="connection-metric"><span>Reconnects</span><strong>{metrics.reconnects}</strong></div>
                    <div className="connection-tooltip-note">Jitter is the primary live-call quality signal. Bandwidth tests pause when active media is detected.</div>
                </div>
            )}
        </div>
    );
};
