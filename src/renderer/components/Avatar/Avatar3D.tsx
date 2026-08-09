/**
 * Avatar3D.tsx
 * ─────────────────────────────────────────────────────────────
 * React wrapper for the AvatarEngine.
 * Drop into REIGAN's right column alongside or replacing the orb.
 *
 * Usage:
 *   <Avatar3D
 *     modelUrl="/models/riruka.glb"
 *     mood="neutral"
 *     view="portrait"
 *     autoSpin
 *   />
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { AvatarEngine, AvatarMood } from './AvatarEngine';

interface Avatar3DProps {
  /** Path or URL to the .glb model file */
  modelUrl: string;
  /** Current mood — drives lighting, rim color, spin speed */
  mood?: AvatarMood;
  /** Camera framing preset */
  view?: 'portrait' | 'full' | 'closeup';
  /** Enable gentle idle rotation */
  autoSpin?: boolean;
  /** Enable orbit controls (drag to rotate) */
  interactive?: boolean;
  /** Additional CSS classes for the container */
  className?: string;
  /** Callback when model finishes loading */
  onLoaded?: () => void;
}

export default function Avatar3D({
  modelUrl,
  mood = 'neutral',
  view = 'portrait',
  autoSpin = true,
  interactive = true,
  className = '',
  onLoaded,
}: Avatar3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<AvatarEngine | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // ── Initialize engine ─────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    const engine = new AvatarEngine(containerRef.current);
    engineRef.current = engine;

    engine.onLoadProgress = (p) => setProgress(Math.round(p * 100));
    engine.onLoadComplete = () => {
      setLoading(false);
      onLoaded?.();
    };
    engine.onLoadError = (err) => {
      setError(err.message);
      setLoading(false);
    };

    engine.loadModel(modelUrl);

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [modelUrl]); // only re-init if the model URL changes

  // ── Sync mood prop ────────────────────────────────────

  useEffect(() => {
    engineRef.current?.setMood(mood);
  }, [mood]);

  // ── Sync view prop ────────────────────────────────────

  useEffect(() => {
    engineRef.current?.setView(view);
  }, [view]);

  // ── Sync auto-spin ────────────────────────────────────

  useEffect(() => {
    engineRef.current?.setAutoSpin(autoSpin);
  }, [autoSpin]);

  // ── Sync interactive ──────────────────────────────────

  useEffect(() => {
    engineRef.current?.setInteractive(interactive);
  }, [interactive]);

  // ── Mood control buttons (dev mode) ───────────────────

  const handleMoodChange = useCallback((newMood: AvatarMood) => {
    engineRef.current?.setMood(newMood);
  }, []);

  return (
    <div className={`avatar-3d-wrapper ${className}`}>
      {/* Three.js canvas mounts here */}
      <div ref={containerRef} className="avatar-canvas-container" />

      {/* Loading overlay */}
      {loading && (
        <div className="avatar-loading-overlay">
          <div className="avatar-loading-spinner" />
          <span className="avatar-loading-text">
            {progress > 0 ? `読み込み中... ${progress}%` : '接続中...'}
          </span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="avatar-error-overlay">
          <span className="avatar-error-icon">⚠</span>
          <span className="avatar-error-text">モデル読み込みエラー</span>
          <span className="avatar-error-detail">{error}</span>
        </div>
      )}

      <style>{`
        .avatar-3d-wrapper {
          position: relative;
          width: 100%;
          height: 100%;
          min-height: 300px;
          overflow: hidden;
          border-radius: 12px;
        }

        .avatar-canvas-container {
          width: 100%;
          height: 100%;
        }

        .avatar-canvas-container canvas {
          display: block;
          width: 100% !important;
          height: 100% !important;
        }

        /* ── Loading ── */
        .avatar-loading-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: var(--bg-surface, #0c1017);
          z-index: 10;
        }

        .avatar-loading-spinner {
          width: 32px;
          height: 32px;
          border: 2px solid rgba(124, 58, 237, 0.2);
          border-top-color: var(--reigan-primary, #7c3aed);
          border-radius: 50%;
          animation: avatar-spin 0.7s linear infinite;
          margin-bottom: 12px;
        }

        @keyframes avatar-spin {
          to { transform: rotate(360deg); }
        }

        .avatar-loading-text {
          font-family: var(--font-kanji, 'Zen Kaku Gothic New', sans-serif);
          font-size: 13px;
          color: var(--text-secondary, #8b95a8);
          letter-spacing: 0.05em;
        }

        /* ── Error ── */
        .avatar-error-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: var(--bg-surface, #0c1017);
          z-index: 10;
        }

        .avatar-error-icon {
          font-size: 24px;
          margin-bottom: 8px;
        }

        .avatar-error-text {
          font-family: var(--font-kanji, 'Zen Kaku Gothic New', sans-serif);
          font-size: 14px;
          color: var(--critical, #ef4444);
          margin-bottom: 4px;
        }

        .avatar-error-detail {
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 11px;
          color: var(--text-muted, #4a5568);
          max-width: 200px;
          text-align: center;
        }
      `}</style>
    </div>
  );
}
