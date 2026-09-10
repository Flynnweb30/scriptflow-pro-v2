import React, { useEffect, useState } from 'react';

export const SpeedTest: React.FC = () => {
    const [loaded, setLoaded] = useState(false);
    const [showFallback, setShowFallback] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            if (!loaded) setShowFallback(true);
        }, 6000);
        return () => window.clearTimeout(timer);
    }, [loaded]);

    return (
        <section className="speed-test-panel">
            <div className="speed-test-header">
                <div>
                    <div className="speed-test-title">Speed Test</div>
                    <div className="speed-test-subtitle">Run Fast.com in a contained workspace. Connection monitoring remains centralized and independent.</div>
                </div>
                <a className="speed-test-open" href="https://fast.com/" target="_blank" rel="noopener noreferrer">Open Speed Test</a>
            </div>
            {!showFallback && (
                <div className="speed-test-frame-wrap">
                    <iframe
                        src="https://fast.com/"
                        title="Fast.com Speed Test"
                        width="100%"
                        height="400"
                        frameBorder="0"
                        scrolling="no"
                        loading="lazy"
                        onLoad={() => setLoaded(true)}
                    />
                </div>
            )}
            {showFallback && (
                <div className="speed-test-fallback">
                    <div className="speed-test-fallback-icon">↗</div>
                    <strong>Fast.com could not be embedded here.</strong>
                    <span>Open the speed test in a new tab for the full test interface.</span>
                    <a className="speed-test-open" href="https://fast.com/" target="_blank" rel="noopener noreferrer">Open Fast.com</a>
                </div>
            )}
        </section>
    );
};
