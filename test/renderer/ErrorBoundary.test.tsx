import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '@/renderer/components/ErrorBoundary'

function GoodChild() {
  return <div>Everything is fine</div>
}

function ThrowingChild(): never {
  throw new Error('Test explosion')
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>
    )

    expect(screen.getByText('Everything is fine')).toBeInTheDocument()
  })

  it('catches thrown error from child component, shows error message in fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Test explosion')).toBeInTheDocument()
  })

  it('fallback UI contains a Reload button', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>
    )

    expect(
      screen.getByRole('button', { name: 'Reload' })
    ).toBeInTheDocument()
  })
})
