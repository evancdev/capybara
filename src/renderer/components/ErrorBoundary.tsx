import React from 'react'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message ?? 'Unknown error'

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: '16px',
            color: 'var(--text-secondary)'
          }}
        >
          <div
            style={{
              fontSize: '16px',
              fontWeight: 500,
              color: 'var(--text-primary)'
            }}
          >
            Something went wrong
          </div>
          <div
            style={{
              fontSize: '13px',
              maxWidth: '480px',
              textAlign: 'center',
              lineHeight: '1.5'
            }}
          >
            An unexpected error occurred in the UI.
          </div>
          <pre
            style={{
              fontSize: '12px',
              maxWidth: '560px',
              maxHeight: '120px',
              overflow: 'auto',
              padding: '10px 14px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--error)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              userSelect: 'all'
            }}
          >
            {errorMessage}
          </pre>
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
              }}
              style={{
                padding: '8px 20px',
                fontSize: '13px',
                color: 'var(--bg-primary)',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontFamily: 'inherit'
              }}
            >
              Try Again
            </button>
            <button
              onClick={() => {
                window.location.reload()
              }}
              style={{
                padding: '8px 20px',
                fontSize: '13px',
                color: 'var(--text-primary)',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontFamily: 'inherit'
              }}
            >
              Reload
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
