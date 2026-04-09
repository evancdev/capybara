import React from 'react'
import styles from '@/renderer/styles/ErrorBoundary.module.css'

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
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message ?? 'Unknown error'

      return (
        <div className={styles.container}>
          <div className={styles.title}>Something went wrong</div>
          <div className={styles.description}>
            An unexpected error occurred in the UI.
          </div>
          <pre className={styles.details}>{errorMessage}</pre>
          <div className={styles.actions}>
            <button
              className={styles.primaryButton}
              onClick={() => {
                this.setState({ hasError: false, error: null })
              }}
            >
              Try Again
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => {
                window.location.reload()
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
