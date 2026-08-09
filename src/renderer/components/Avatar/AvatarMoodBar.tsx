/**
 * AvatarMoodBar.tsx
 * ─────────────────────────────────────────────────────────────
 * Mood toggle bar for the avatar. Can be used as:
 *   - Dev tool for testing mood transitions
 *   - Production UI for manual mood override
 *   - Hidden and driven entirely by REIGAN's state machine
 *
 * Each mood adjusts the avatar's rim light color, background
 * tint, ambient intensity, and spin speed via smooth lerp.
 * ─────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { AvatarMood } from './AvatarEngine';

interface AvatarMoodBarProps {
  currentMood: AvatarMood;
  onMoodChange: (mood: AvatarMood) => void;
  className?: string;
}

const MOODS: { key: AvatarMood; label: string; kanji: string; color: string }[] = [
  { key: 'neutral',  label: 'Neutral',  kanji: '平常', color: '#7c3aed' },
  { key: 'happy',    label: 'Happy',    kanji: '喜び', color: '#00d4ff' },
  { key: 'thinking', label: 'Thinking', kanji: '思考', color: '#a78bfa' },
  { key: 'speaking', label: 'Speaking', kanji: '発話', color: '#10b981' },
  { key: 'alert',    label: 'Alert',    kanji: '警戒', color: '#f59e0b' },
  { key: 'error',    label: 'Error',    kanji: '障害', color: '#ef4444' },
];

export default function AvatarMoodBar({
  currentMood,
  onMoodChange,
  className = '',
}: AvatarMoodBarProps) {
  return (
    <div className={`mood-bar ${className}`}>
      {MOODS.map(({ key, label, kanji, color }) => (
        <button
          key={key}
          className={`mood-btn ${currentMood === key ? 'active' : ''}`}
          onClick={() => onMoodChange(key)}
          title={`${label} (${kanji})`}
          style={{
            '--mood-color': color,
          } as React.CSSProperties}
        >
          <span className="mood-kanji">{kanji}</span>
          <span className="mood-label">{label}</span>
        </button>
      ))}

      <style>{`
        .mood-bar {
          display: flex;
          gap: 4px;
          padding: 8px 10px;
          background: var(--bg-elevated, #141922);
          border-radius: 10px;
          border: 1px solid var(--border, rgba(255,255,255,0.06));
          overflow-x: auto;
          scrollbar-width: none;
        }
        .mood-bar::-webkit-scrollbar { display: none; }

        .mood-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: 6px 10px;
          border-radius: 8px;
          border: 1px solid transparent;
          background: transparent;
          cursor: pointer;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }

        .mood-btn:hover {
          background: rgba(255,255,255,0.04);
          border-color: var(--mood-color);
        }

        .mood-btn.active {
          background: color-mix(in srgb, var(--mood-color) 15%, transparent);
          border-color: var(--mood-color);
          box-shadow: 0 0 12px color-mix(in srgb, var(--mood-color) 25%, transparent);
        }

        .mood-kanji {
          font-family: var(--font-kanji, 'Zen Kaku Gothic New', sans-serif);
          font-size: 14px;
          color: var(--text-secondary, #8b95a8);
          transition: color 0.2s;
        }

        .mood-btn.active .mood-kanji {
          color: var(--mood-color);
        }

        .mood-label {
          font-family: var(--font-body, 'Inter', sans-serif);
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-muted, #4a5568);
        }

        .mood-btn.active .mood-label {
          color: var(--text-secondary, #8b95a8);
        }
      `}</style>
    </div>
  );
}
