import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { MediaPlayerProvider } from '@/components/media/MediaPlayer'
import './index.css'
import './i18n/i18n'


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <MediaPlayerProvider><App /></MediaPlayerProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
