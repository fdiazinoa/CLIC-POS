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
    },
    build: {
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
                return 'vendor-react';
              }
              if (id.includes('/framer-motion/')) {
                return 'vendor-motion';
              }
              if (id.includes('/lucide-react/')) {
                return 'vendor-icons';
              }
              if (id.includes('/html5-qrcode/')) {
                return 'vendor-scanner';
              }
              if (
                id.includes('/@google/genai/') ||
                id.includes('/papaparse/') ||
                id.includes('/xlsx/')
              ) {
                return 'vendor-data';
              }
              if (id.includes('/sql.js/')) {
                return 'vendor-sql';
              }
              return 'vendor-misc';
            }

            if (id.includes('/components/POSInterface.tsx')) {
              return 'pos-shell';
            }
            if (id.includes('/components/TableMap.tsx') || id.includes('/components/TableLayoutDesigner.tsx')) {
              return 'tables-suite';
            }
            if (id.includes('/components/kds/') || id.includes('/components/ProductionAreaManager.tsx')) {
              return 'kds-suite';
            }
            if (id.includes('/components/price-checker/')) {
              return 'price-checker-suite';
            }
            if (
              id.includes('/components/inventory/') ||
              id.includes('/components/InventoryTracking.tsx') ||
              id.includes('/components/InventoryAudit.tsx') ||
              id.includes('/components/InventoryOptimizer.tsx')
            ) {
              return 'inventory-suite';
            }
            if (
              id.includes('/components/Settings.tsx') ||
              id.includes('/components/SettingsOperational.tsx') ||
              id.includes('/components/SyncSettings.tsx') ||
              id.includes('/components/TerminalSettings.tsx') ||
              id.includes('/components/DocumentSettings.tsx') ||
              id.includes('/components/HardwareSettings.tsx') ||
              id.includes('/components/PaymentSettings.tsx') ||
              id.includes('/components/TipsSettings.tsx') ||
              id.includes('/components/CurrencySettings.tsx')
            ) {
              return 'settings-suite';
            }
            if (
              id.includes('/components/CatalogManager.tsx') ||
              id.includes('/components/ProductForm.tsx') ||
              id.includes('/components/ClassificationManager.tsx') ||
              id.includes('/components/RecipeManager.tsx') ||
              id.includes('/components/VariantManager.tsx')
            ) {
              return 'catalog-suite';
            }
            if (
              id.includes('/components/FinanceDashboard.tsx') ||
              id.includes('/components/ReportDashboard.tsx') ||
              id.includes('/components/ReportViewer.tsx') ||
              id.includes('/components/ZReportDashboard.tsx') ||
              id.includes('/components/ZReportHistory.tsx') ||
              id.includes('/components/TicketHistory.tsx')
            ) {
              return 'reporting-suite';
            }
            if (
              id.includes('/components/SupplyChainManager.tsx') ||
              id.includes('/components/WarehouseManager.tsx') ||
              id.includes('/components/SmartReplenishment.tsx') ||
              id.includes('/components/SourcingIntelligence.tsx')
            ) {
              return 'supply-suite';
            }

            return undefined;
          }
        }
      }
    }
  };
});
