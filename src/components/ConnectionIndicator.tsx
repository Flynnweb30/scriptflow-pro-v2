import React, { useEffect, useRef, useState } from 'react';
import { NetworkMonitor, NetworkSnapshot } from '../services/NetworkMonitorService';

const metric = (value: number | null, unit: string) => value === null || !Number.isFinite(value) ? 'N/A' : `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
const pct = (value: number | null) => value === null || !Number.isFinite(value) ? 'N/A' : `${value.toFixed(1)}%`;

export const ConnectionIndicator: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
    const [snapshot, setSnapshot] = useState<NetworkSnapshot>(NetworkMonitor.getSnapshot());
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
    const closeTimerRef = useRef<number | null>(null);

    const keepPopoverOpen = () => {
        if (closeTimerRef.current !== null) {
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
        setOpen(true);
    };

    const schedulePopoverClose = () => {
        if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = window.setTimeout(() => {
            setOpen(false);
            closeTimerRef.current = null;
        }, 140);
    };

    useEffect(() => {
        const unsubscribe = NetworkMonitor.subscribe(setSnapshot);
        return () => {
            unsubscribe();
            if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
        };
    }, []);

    useEffect(() => {
        if (!open) return;
        const updatePopoverPosition = () => {
            const button = buttonRef.current;
            if (!button) return;
            const rect = button.getBoundingClientRect();
            const width = Math.min(228, Math.max(180, window.innerWidth - 20));
            const left = Math.min(rect.right + 8, window.innerWidth - width - 10);
            const top = Math.max(10, Math.min(rect.top, window.innerHeight - 190));
            setPopoverStyle({ left, top, width });
        };
        updatePopoverPosition();
        window.addEventListener('resize', updatePopoverPosition);
        window.addEventListener('scroll', updatePopoverPosition, true);
        return () => {
            window.removeEventListener('resize', updatePopoverPosition);
            window.removeEventListener('scroll', updatePopoverPosition, true);
        };
    }, [open]);

    const label = snapshot.state === 'checking' ? 'Checking connection…' : snapshot.state === 'offline' ? 'Offline' : `${snapshot.bars}/4 bars`;
    const barClass = snapshot.state === 'offline' ? 'offline' : snapshot.state === 'degraded' ? 'degraded' : snapshot.state === 'checking' ? 'checking' : 'online';

    return (
        <div className={`connection-indicator ${compact ? 'connection-indicator--compact' : ''}`} onMouseLeave={schedulePopoverClose} onMouseEnter={keepPopoverOpen}>
            <button
                type="button"
                ref={buttonRef}
                className={`connection-indicator__button ${barClass}`}
                onClick={() => setOpen(v => !v)}
                onMouseEnter={keepPopoverOpen}
                aria-label={`Internet connection: ${label}`}
                title={label}
            >
                <span className="connection-bars" aria-hidden="true">
                    {[1, 2, 3, 4].map(bar => <span key={bar} className={snapshot.bars >= bar ? 'active' : ''} />)}
                </span>
                {!compact && <span className="connection-indicator__label">{label}</span>}
            </button>

            {open && (
                <div className="connection-popover" style={popoverStyle} role="dialog" aria-label="Connection diagnostics" onMouseEnter={keepPopoverOpen} onMouseLeave={schedulePopoverClose}>
                    <div className="connection-popover__header">
                        <strong>Connection</strong>
                        <span className={`connection-state-dot ${barClass}`} />
                    </div>
                    <div className="connection-popover__status">{label}</div>
                    <div className="connection-metrics">
                        <div><span>Round trip</span><strong>{metric(snapshot.latencyMs, 'ms')}</strong></div>
                        <div><span>Jitter</span><strong>{metric(snapshot.jitterMs, 'ms')}</strong></div>
                        <div><span>Packet loss</span><strong>{pct(snapshot.packetLossPct)}</strong></div>
                        <div><span>Stability</span><strong>{pct(snapshot.stabilityPct)}</strong></div>
                        <div><span>Download</span><strong>{metric(snapshot.downloadMbps, 'Mbps')}</strong></div>
                        <div><span>Upload</span><strong>{metric(snapshot.uploadMbps, 'Mbps')}</strong></div>
                        <div><span>Live-call audio loss</span><strong>{pct(snapshot.liveCallAudioLossPct)}</strong></div>
                        <div><span>Live-call jitter</span><strong>{metric(snapshot.liveCallJitterMs, 'ms')}</strong></div>
                        <div><span>Reconnects</span><strong>{snapshot.reconnects}</strong></div>
                    </div>
                    <div className="connection-popover__note">
                        Measurements are browser-observed. Bandwidth tests pause during an active WebRTC call.
                    </div>
                </div>
            )}
        </div>
    );
};
