import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { registerLeafPdfServiceWorker } from './pwa/registerServiceWorker'
import './styles.css'
import './nextLevel.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

void registerLeafPdfServiceWorker()
