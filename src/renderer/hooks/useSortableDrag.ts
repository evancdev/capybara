import { useState, useRef, useCallback, useEffect } from 'react'
import type {
  RefObject,
  PointerEvent as ReactPointerEvent,
  CSSProperties
} from 'react'

interface DragState {
  draggingId: string
  fromIndex: number
  overIndex: number
}

interface DragItemProps {
  onPointerDown: (e: ReactPointerEvent) => void
  style: CSSProperties
  'data-drag-index': number
}

interface UseSortableDragOptions {
  items: readonly string[]
  onReorder: (fromIndex: number, toIndex: number) => void
  isDisabled?: (id: string) => boolean
}

interface UseSortableDragResult {
  dragState: DragState | null
  getItemProps: (id: string, index: number) => DragItemProps
  listRef: RefObject<HTMLDivElement>
}

const DRAG_THRESHOLD = 5
const TRANSITION = 'transform 0.15s ease'

export function useSortableDrag({
  items: _items,
  onReorder,
  isDisabled
}: UseSortableDragOptions): UseSortableDragResult {
  const [dragState, setDragState] = useState<DragState | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Mutable refs for drag tracking (avoids re-renders on every pointermove)
  const pointerStartRef = useRef({ x: 0, y: 0 })
  const draggingRef = useRef(false)
  const pendingIdRef = useRef<string | null>(null)
  const pendingIndexRef = useRef(-1)
  const itemRectsRef = useRef<DOMRect[]>([])
  const itemHeightRef = useRef(0)
  const currentOverIndexRef = useRef(-1)
  const dragStateRef = useRef<DragState | null>(null)

  // Keep dragStateRef in sync
  useEffect(() => {
    dragStateRef.current = dragState
  }, [dragState])

  const measureItems = useCallback(() => {
    const list = listRef.current
    if (!list) return
    const children = list.querySelectorAll<HTMLElement>('[data-drag-index]')
    const rects: DOMRect[] = []
    children.forEach((child) => {
      rects.push(child.getBoundingClientRect())
    })
    itemRectsRef.current = rects
    if (rects.length > 0) {
      itemHeightRef.current = rects[0].height
    }
  }, [])

  const endDrag = useCallback(
    (commit: boolean) => {
      if (!draggingRef.current) {
        // Never actually started dragging (below threshold)
        pendingIdRef.current = null
        pendingIndexRef.current = -1
        return
      }

      const state = dragStateRef.current
      if (commit && state && state.fromIndex !== state.overIndex) {
        onReorder(state.fromIndex, state.overIndex)
      }

      draggingRef.current = false
      pendingIdRef.current = null
      pendingIndexRef.current = -1
      currentOverIndexRef.current = -1
      setDragState(null)
    },
    [onReorder]
  )

  // Document-level listeners during drag. Keyed only on whether a drag is
  // active — not on dragState — so that per-pointermove overIndex updates
  // don't tear down and re-register four listeners on every slot crossing.
  const isDragging = dragState !== null
  useEffect(() => {
    if (!isDragging) return

    const onPointerMove = (e: globalThis.PointerEvent): void => {
      const rects = itemRectsRef.current
      if (rects.length === 0) return
      const state = dragStateRef.current
      if (!state) return

      const pointerY = e.clientY
      let newOverIndex = state.fromIndex

      // Find which slot the pointer is over by checking midpoints
      for (let i = 0; i < rects.length; i++) {
        const midY = rects[i].top + rects[i].height / 2
        if (pointerY < midY) {
          newOverIndex = i
          break
        }
        if (i === rects.length - 1) {
          newOverIndex = rects.length - 1
        }
      }

      if (newOverIndex !== currentOverIndexRef.current) {
        currentOverIndexRef.current = newOverIndex
        setDragState((prev) =>
          prev ? { ...prev, overIndex: newOverIndex } : null
        )
      }
    }

    const onPointerUp = (): void => {
      endDrag(true)
    }

    const onPointerCancel = (): void => {
      endDrag(false)
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        endDrag(false)
      }
    }

    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerCancel)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerCancel)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isDragging, endDrag])

  // Clean up if component unmounts mid-drag
  useEffect(() => {
    return () => {
      draggingRef.current = false
    }
  }, [])

  const handlePointerDown = useCallback(
    (id: string, index: number, e: ReactPointerEvent) => {
      // Don't drag from interactive children (buttons, inputs)
      const target = e.target as HTMLElement
      if (
        target.tagName === 'BUTTON' ||
        target.tagName === 'INPUT' ||
        target.closest('button') ||
        target.closest('input')
      ) {
        return
      }

      if (isDisabled?.(id)) return

      pendingIdRef.current = id
      pendingIndexRef.current = index
      pointerStartRef.current = { x: e.clientX, y: e.clientY }

      // Capture pointer for reliable tracking even outside the element
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)

      const pointerId = e.pointerId
      const currentTarget = e.currentTarget as HTMLElement

      const onMove = (me: globalThis.PointerEvent): void => {
        const dx = me.clientX - pointerStartRef.current.x
        const dy = me.clientY - pointerStartRef.current.y
        const distance = Math.sqrt(dx * dx + dy * dy)

        if (distance >= DRAG_THRESHOLD && !draggingRef.current) {
          draggingRef.current = true
          measureItems()
          currentOverIndexRef.current = index
          setDragState({ draggingId: id, fromIndex: index, overIndex: index })

          // Remove this threshold listener — document listeners take over
          currentTarget.removeEventListener('pointermove', onMove)
        }
      }

      const onUp = (): void => {
        // Pointer released before threshold — not a drag
        currentTarget.removeEventListener('pointermove', onMove)
        currentTarget.removeEventListener('pointerup', onUp)
        try {
          currentTarget.releasePointerCapture(pointerId)
        } catch {
          // Already released
        }
        if (!draggingRef.current) {
          pendingIdRef.current = null
          pendingIndexRef.current = -1
        }
      }

      currentTarget.addEventListener('pointermove', onMove)
      currentTarget.addEventListener('pointerup', onUp)
    },
    [isDisabled, measureItems]
  )

  const getItemProps = useCallback(
    (id: string, index: number): DragItemProps => {
      const style: CSSProperties = {}

      if (dragState) {
        const { fromIndex, overIndex, draggingId } = dragState

        if (id === draggingId) {
          // The dragged item: no transform shift (it stays in place visually,
          // the other items move around it)
          style.zIndex = 1
          style.position = 'relative'
          style.transition = 'none'
        } else {
          // Other items: shift to make room
          if (fromIndex < overIndex) {
            // Dragging down: items between (fromIndex, overIndex] shift up
            if (index > fromIndex && index <= overIndex) {
              style.transform = `translateY(-${itemHeightRef.current}px)`
            }
          } else if (fromIndex > overIndex) {
            // Dragging up: items between [overIndex, fromIndex) shift down
            if (index >= overIndex && index < fromIndex) {
              style.transform = `translateY(${itemHeightRef.current}px)`
            }
          }
          style.transition = TRANSITION
        }
      }

      return {
        onPointerDown: (e: ReactPointerEvent) => {
          handlePointerDown(id, index, e)
        },
        style,
        'data-drag-index': index
      }
    },
    [dragState, handlePointerDown]
  )

  return {
    dragState,
    getItemProps,
    listRef
  }
}
