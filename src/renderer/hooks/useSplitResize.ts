import { useState, useCallback, useEffect, useRef } from 'react'
import type { RefObject, MouseEvent as ReactMouseEvent } from 'react'

const MIN_PANEL_WIDTH = 200

interface UseSplitResizeOptions {
  panelCount: number
  containerRef: RefObject<HTMLDivElement>
}

interface UseSplitResizeResult {
  panelSizes: number[]
  onDividerMouseDown: (dividerIndex: number, event: ReactMouseEvent) => void
}

function equalSizes(count: number): number[] {
  if (count <= 0) return []
  const size = 100 / count
  return Array.from({ length: count }, () => size)
}

export function useSplitResize({
  panelCount,
  containerRef
}: UseSplitResizeOptions): UseSplitResizeResult {
  const [panelSizes, setPanelSizes] = useState<number[]>(() =>
    equalSizes(panelCount)
  )

  // Re-distribute equally when panel count changes
  useEffect(() => {
    setPanelSizes(equalSizes(panelCount))
  }, [panelCount])

  // Mutable refs for drag state (avoids stale closures in mousemove)
  const draggingRef = useRef(false)
  const dividerIndexRef = useRef(-1)
  const startXRef = useRef(0)
  const startSizesRef = useRef<number[]>([])

  const onDividerMouseDown = useCallback(
    (dividerIndex: number, event: ReactMouseEvent) => {
      event.preventDefault()
      const container = containerRef.current
      if (!container) return

      draggingRef.current = true
      dividerIndexRef.current = dividerIndex
      startXRef.current = event.clientX
      startSizesRef.current = [...panelSizes]

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const containerWidth = container.getBoundingClientRect().width
      const minPercent = (MIN_PANEL_WIDTH / containerWidth) * 100

      const onMouseMove = (e: globalThis.MouseEvent): void => {
        if (!draggingRef.current) return

        const dx = e.clientX - startXRef.current
        const deltaPercent = (dx / containerWidth) * 100

        const idx = dividerIndexRef.current
        const sizes = [...startSizesRef.current]

        let leftSize = sizes[idx] + deltaPercent
        let rightSize = sizes[idx + 1] - deltaPercent

        // Clamp to minimum
        if (leftSize < minPercent) {
          rightSize -= minPercent - leftSize
          leftSize = minPercent
        }
        if (rightSize < minPercent) {
          leftSize -= minPercent - rightSize
          rightSize = minPercent
        }

        sizes[idx] = leftSize
        sizes[idx + 1] = rightSize
        setPanelSizes(sizes)
      }

      const onMouseUp = (): void => {
        draggingRef.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', onMouseMove, true)
        document.removeEventListener('mouseup', onMouseUp, true)
      }

      document.addEventListener('mousemove', onMouseMove, true)
      document.addEventListener('mouseup', onMouseUp, true)
    },
    [containerRef, panelSizes]
  )

  // Clean up on unmount if drag is in progress
  useEffect(() => {
    return () => {
      if (draggingRef.current) {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [])

  return { panelSizes, onDividerMouseDown }
}
