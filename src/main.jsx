import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './context/AuthProvider'
import { CityProvider } from './context/CityProvider'
import App from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CityProvider>
          <App />
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                fontSize: '13px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
              },
            }}
          />
        </CityProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
