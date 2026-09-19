import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// GitHub Pages only serves files that exist. Each in-app page gets a real copy of index.html
// (tier-list/index.html answers 200) plus 404.html for any other path, so a direct load or refresh works.
function spaPages(): Plugin {
  let outDir = 'dist'
  return {
    name: 'spa-pages',
    apply: 'build',
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir)
    },
    closeBundle() {
      const index = path.join(outDir, 'index.html')
      mkdirSync(path.join(outDir, 'tier-list'), { recursive: true })
      copyFileSync(index, path.join(outDir, 'tier-list', 'index.html'))
      copyFileSync(index, path.join(outDir, '404.html'))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), spaPages()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
})
