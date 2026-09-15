import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppProvider } from './store'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('找不到挂载节点 #root')

createRoot(container).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
)
