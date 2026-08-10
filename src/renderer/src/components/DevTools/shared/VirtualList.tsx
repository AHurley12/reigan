import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Fixed-height windowing for the tab's long lists.
 *
 * A scan of a real drive returns hundreds of projects and a duplicate sweep
 * thousands of files; rendering those as DOM nodes drops frames on every
 * scroll. Rows here are a fixed height by construction, which is what lets the
 * visible window be arithmetic rather than measurement.
 */

interface Props<T> {
  items: T[]
  rowHeight: number
  renderRow: (item: T, index: number) => ReactNode
  /** Rows rendered beyond the viewport, to hide the seam while scrolling. */
  overscan?: number
  className?: string
  emptyState?: ReactNode
}

export function VirtualList<T>({
  items,
  rowHeight,
  renderRow,
  overscan = 6,
  className,
  emptyState,
}: Props<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight))
    observer.observe(element)
    setViewportHeight(element.clientHeight)
    return () => observer.disconnect()
  }, [])

  if (items.length === 0 && emptyState) return <>{emptyState}</>

  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const visibleCount = Math.ceil((viewportHeight || rowHeight * 12) / rowHeight) + overscan * 2
  const last = Math.min(items.length, first + visibleCount)
  const visible = items.slice(first, last)

  return (
    <div
      ref={containerRef}
      className={className}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      style={{ overflowY: 'auto', overflowX: 'hidden' }}
    >
      {/* Full-height spacer so the scrollbar reflects the real list length. */}
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${first * rowHeight}px)` }}>
          {visible.map((item, i) => (
            <div key={first + i} style={{ height: rowHeight }}>
              {renderRow(item, first + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
