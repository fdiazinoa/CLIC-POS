import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  // Read certificates if they exist
  // Read certificates if they exist and USE_HTTPS is true
  const useHttps = process.env.USE_HTTPS === 'true';
  const httpsConfig = useHttps && fs.existsSync('./cert.pem') && fs.existsSync('./key.pem')
    ? {
      key: fs.readFileSync('./key.pem'),
      cert: fs.readFileSync('./cert.pem'),
    }
    : undefined;

  console.log(`🔒 Vite HTTP Mode: ${httpsConfig ? 'HTTPS' : 'HTTP'}`);


  return {
    server: {
      port: 3000,
      strictPort: true,
      host: '0.0.0.0',
      https: httpsConfig,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false, // Don't verify self-signed certs for proxy
          xfwd: true
        },
        '/smtp': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
          xfwd: true
        }
      }
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
