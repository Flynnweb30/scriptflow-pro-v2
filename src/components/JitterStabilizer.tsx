import React, { useEffect, useState } from 'react';
import { NetworkMonitor, NetworkSnapshot } from '../services/NetworkMonitorService';

const value = (n: number | null, unit = '') => n === null || !Number.isFinite(n) ? 'N/A' : `${n < 10 ? n.toFixed(1) : Math.round(n)}${unit ? ` ${unit}` : ''}`;

export const JitterStabilizer: React.FC = () => {
    const [snapshot, setSnapshot] = useState<NetworkSnapshot>(NetworkMonitor.getSnapshot());
    const [lowNetworkMode, setLowNetworkMode] = useState(NetworkMonitor.isLowNetworkMode());

    useEffect(() => NetworkMonitor.subscribe(setSnapshot), []);

    const toggle = () => {
        const next = !lowNetworkMode;
        NetworkMonitor.setLowNetworkMode(next);
        setLowNetworkMode(next);
    };

    return (
        <section className="jitter-stabilizer-page">
            <div className="jitter-stabilizer-page__header">
                <div>
                    <div className="eyebrow">TOOLS & SETTINGS</div>
                    <h1>Jitter Stabilizer</h1>
                    <p>Lightweight browser-side call protection. It does not alter or falsify measured jitter.</p>
                </div>
                <button type="button" className={`jitter-stabilizer-toggle ${lowNetworkMode ? 'is-on' : ''}`} onClick={toggle}>
                    {lowNetworkMode ? 'Low-network mode: On' : 'Low-network mode: Off'}
                </button>
            </div>

            <div className="jitter-stabilizer-grid">
                <div className="jitter-stabilizer-card">
                    <span>Live jitter</span>
                    <strong>{value(snapshot.jitterMs, 'ms')}</strong>
                    <small>Raw browser measurement</small>
                </div>
                <div className="jitter-stabilizer-card">
                    <span>Round trip</span>
                    <strong>{value(snapshot.latencyMs, 'ms')}</strong>
                    <small>Latest probe</small>
                </div>
                <div className="jitter-stabilizer-card">
                    <span>Live-call audio loss</span>
                    <strong>{value(snapshot.liveCallAudioLossPct, '%')}</strong>
                    <small>Only when an actual WebRTC session is registered</small>
                </div>
            </div>

            <div className="jitter-stabilizer-card jitter-stabilizer-card--wide">
                <h2>What protection does</h2>
                <ul>
                    <li>Pauses bandwidth tests while a live WebRTC call is active.</li>
                    <li>Prevents duplicate probe and bandwidth requests.</li>
                    <li>Pauses background monitoring while the tab is hidden.</li>
                    <li>Keeps jitter and connection bars based only on measured values.</li>
                    <li>Uses WebRTC statistics for call jitter and audio packet loss when available.</li>
                </ul>
                <p className="jitter-stabilizer-note">This cannot physically reduce ISP/Wi-Fi jitter. It only reduces ScriptFlow background network activity.</p>
            </div>
        </section>
    );
};
