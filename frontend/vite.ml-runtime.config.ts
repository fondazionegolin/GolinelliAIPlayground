import { defineConfig } from 'vite'

// Standalone script (public/lib/goliai-ml.js) that Vibe Lab previews load to run ML Lab models inside their iframe.
export default defineConfig({
  publicDir: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'public/lib',
    emptyOutDir: false,
    target: 'es2020',
    lib: { entry: 'src/runtime/goliaiMl.ts', name: '__goliaiMlBundle', formats: ['iife'], fileName: () => 'goliai-ml.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
    chunkSizeWarningLimit: 6000,
  },
})
