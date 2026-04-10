import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:8000',
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-ui': ['framer-motion', 'lucide-react'],
          'vendor-i18n': ['react-i18next', 'i18next'],
          'vendor-markdown': ['react-markdown', 'remark-gfm', 'remark-math', 'rehype-katex', 'katex'],
          'vendor-editor': [
            '@uiw/react-codemirror',
            '@codemirror/autocomplete',
            '@codemirror/lang-javascript',
            '@codemirror/lang-python',
            '@codemirror/state',
            '@codemirror/view',
          ],
          'vendor-plotly': ['react-plotly.js', 'plotly.js-dist-min'],
        },
      },
    },
  },
})
