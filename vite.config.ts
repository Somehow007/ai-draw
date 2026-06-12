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
    port: 5173,
    proxy: {
      '/api/llm/deepseek': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/llm\/deepseek/, ''),
      },
      '/api/llm/qwen': {
        target: 'https://dashscope.aliyuncs.com/compatible-mode',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/llm\/qwen/, ''),
      },
      '/api/llm/zhipu': {
        target: 'https://open.bigmodel.cn/api/paas',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/llm\/zhipu/, ''),
      },
    },
  },
})
