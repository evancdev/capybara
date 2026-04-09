import { useEffect, useState } from 'react'

export const SPINNER_CHARS = [
  '\u00B7',
  '\u273B',
  '\u273D',
  '\u2736',
  '\u2733',
  '\u2722'
] // · ✻ ✽ ✶ ✳ ✢
export const SPINNER_INTERVAL_MS = 300

/** Returns the current spinner character, cycling every `SPINNER_INTERVAL_MS`. */
export function useSpinner(): string {
  const [charIndex, setCharIndex] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      setCharIndex((prev) => (prev + 1) % SPINNER_CHARS.length)
    }, SPINNER_INTERVAL_MS)
    return () => {
      clearInterval(id)
    }
  }, [])
  return SPINNER_CHARS[charIndex]
}
