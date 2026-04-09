import ReactDOM from 'react-dom/client'
import { App } from '@/renderer/App'
import './styles/global.css'
import './styles/streamdown-tokens.css'
import './styles/ui.css'

window.addEventListener('error', (event) => {
  console.error('[Unhandled Error]', event.error)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Rejection]', event.reason)
})

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element not found')
}
ReactDOM.createRoot(root).render(<App />)
