import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ServerStateProvider } from './components/ServerStateProvider'
import { createServerState } from './serverState'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServerStateProvider state={createServerState()}>
      <App />
    </ServerStateProvider>
  </StrictMode>,
)
