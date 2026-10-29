import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Standalone script (public/lib/goliai-ml.js) that Vibe Lab previews load to run ML Lab models inside their iframe.
export default defineConfig({
  publicDir: false,
  // Shared modules translate UI strings with tl(); the runtime bundle gets a dependency-free stub.
  resolve: { alias: { '@/i18n/tl': fileURLToPath(new URL('./src/runtime/tlStub.ts', import.meta.url)) } },
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
