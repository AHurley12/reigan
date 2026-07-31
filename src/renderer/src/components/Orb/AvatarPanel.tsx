import { useAppStore } from '../../stores/appStore'
import { STATE_COLORS } from '../../../../shared/constants'

// Placeholder for the anime avatar (GLB model via Avatar3D/AvatarEngine).
// Swap the inner circle block for <Avatar3D modelUrl={...} mood={...} /> once those land.
export function AvatarPanel() {
  const reiganState = useAppStore((s) => s.reiganState)
  const color = STATE_COLORS[reiganState]

  return (
    <div
      className="w-full flex flex-col items-center justify-center gap-2 rounded-lg"
      style={{
        height: 200,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
      }}
    >
      <div
        className="rounded-full transition-colors duration-300"
        style={{
          width: 84,
          height: 84,
          border: `2px solid ${color}`,
          boxShadow: `0 0 20px ${color}55`,
        }}
      />
      <span className="text-[10px] font-mono tracking-wide" style={{ color: 'var(--text-muted)' }}>
        awaiting avatar model
      </span>
    </div>
  )
}
