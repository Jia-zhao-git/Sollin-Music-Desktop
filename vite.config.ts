import { defineConfig, type Connect } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import http from 'http'
import https from 'https'
import { URL } from 'url'

const DEV_HTTP_PROXY_PATH = '/__dev_http_proxy'

const DEV_PROXY_BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

const writeProxyError = (res: Connect.ServerResponse, status: number, message: string) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(message)
}

const installDevHttpProxy = (): NonNullable<ReturnType<typeof defineConfig>['plugins']>[number] => ({
  name: 'sollin-dev-http-proxy',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use(DEV_HTTP_PROXY_PATH, (req, res) => {
      const requestUrl = new URL(req.url || '', 'http://localhost')
      const target = requestUrl.searchParams.get('url')
      if (!target) return writeProxyError(res, 400, 'Missing proxy target url')

      let targetUrl: URL
      try {
        targetUrl = new URL(target)
      } catch {
        return writeProxyError(res, 400, 'Invalid proxy target url')
      }

      if (!['http:', 'https:'].includes(targetUrl.protocol)) {
        return writeProxyError(res, 400, 'Unsupported proxy protocol')
      }
      if (DEV_PROXY_BLOCKED_HOSTS.has(targetUrl.hostname)) {
        return writeProxyError(res, 403, 'Proxy target host is blocked')
      }

      const client = targetUrl.protocol === 'https:' ? https : http
      const upstreamReq = client.request(targetUrl, {
        method: req.method || 'GET',
        headers: {
          ...req.headers,
          host: targetUrl.host,
          origin: targetUrl.origin,
          referer: targetUrl.origin + '/',
        },
      }, (upstreamRes) => {
        res.statusCode = upstreamRes.statusCode || 200
        Object.entries(upstreamRes.headers).forEach(([key, value]) => {
          if (value !== undefined) res.setHeader(key, value)
        })
        res.setHeader('Access-Control-Allow-Origin', '*')
        upstreamRes.pipe(res)
      })

      upstreamReq.on('error', (error) => writeProxyError(res, 502, error.message || 'Proxy request failed'))
      req.pipe(upstreamReq)
    })
  },
})

export default defineConfig({
  plugins: [react(), installDevHttpProxy()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@services': path.resolve(__dirname, './src/services'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@types': path.resolve(__dirname, './src/types'),
    },
  },
  server: {
    port: Number(process.env.VITE_DEV_SERVER_PORT || 5173),
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        desktopLyrics: path.resolve(__dirname, 'desktop-lyrics.html'),
      },
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          ui: ['framer-motion', 'lucide-react'],
          radix: [
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-slider',
            '@radix-ui/react-dialog',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-context-menu',
            '@radix-ui/react-toast',
          ],
          state: ['zustand', 'localforage'],
          utils: ['axios', 'date-fns', 'clsx', 'tailwind-merge', 'crypto-js'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          virtual: ['@tanstack/react-virtual'],
        },
      },
    },
  },
})
