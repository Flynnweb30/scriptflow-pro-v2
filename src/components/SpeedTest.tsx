import React, { useEffect, useState } from 'react';

export const SpeedTest: React.FC = () => {
    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
        const timer = window.setTimeout(() => setLoaded(true), 0);
        return () => window.clearTimeout(timer);
    }, []);

    return (
        <section className="speed-test-page">
            <div className="speed-test-page__header">
                <div>
                    <div className="eyebrow">TOOLS & SETTINGS</div>
                    <h1>Speed Test</h1>
                    <p>Run Fast.com separately from ScriptFlow’s internal connection monitor.</p>
                </div>
                <a className="speed-test-page__fallback" href="https://fast.com/" target="_blank" rel="noreferrer">Open Fast.com ↗</a>
            </div>
            <div className="speed-test-frame">
                {loaded && (
                    <iframe
                        src="https://fast.com/"
                        width="100%"
                        height="400"
                        frameBorder="0"
                        scrolling="no"
                        title="Fast.com speed test"
                    />
                )}
            </div>
            <p className="speed-test-page__help">If Fast.com cannot be embedded by the browser or network policy, use <a href="https://fast.com/" target="_blank" rel="noreferrer">Open Fast.com</a>.</p>
        </section>
    );
};
