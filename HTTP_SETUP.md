# Configuración HTTP/HTTPS - Resumen Rápido

## ✅ Migración Completada

CLIC-POS ahora usa:
- **HTTP** para red local (sin certificados SSL)
- **HTTPS** para ERP Cloud (cuando `CLOUD_MODE=true`)

## 🚀 Arrancar Servidor

### Modo Local (default)
```bash
npm run server
# 🚀 Local Server (HTTP) running on http://0.0.0.0:3001
```

### Modo Cloud
```bash
CLOUD_MODE=true npm run server
# 🔒 Cloud Server (HTTPS) running on https://0.0.0.0:3001
```

## 📝 Configuración

Copia `.env.example` a `.env` y ajusta según necesites:

```env
# Red local
CLOUD_MODE=false
PORT=3001
HOST=0.0.0.0

# ERP Cloud (descomentar cuando sea necesario)
# CLOUD_MODE=true
# SSL_KEY_PATH=/path/to/key.pem
# SSL_CERT_PATH=/path/to/cert.pem
```

## 🔐 WebAuthn (Login Biométrico)

✅ **Funciona perfectamente sin HTTPS** porque `localhost` es contexto seguro.

## 📚 Documentación Completa

- [Arquitectura de Red](./docs/NETWORK_ARCHITECTURE.md) - Esquema multi-tienda, deployment
- [Walkthrough](../brain/42a135ee-2a34-4fe7-ac71-2907869341ac/walkthrough.md) - Cambios realizados
- [Plan](../brain/42a135ee-2a34-4fe7-ac71-2907869341ac/implementation_plan.md) - Diseño técnico

## 🎯 Beneficios

| Antes | Ahora |
|-------|-------|
| ❌ Certificados SSL en desarrollo | ✅ HTTP directo, sin fricción |
| ❌ Warnings de certificado autofirmado | ✅ Sin warnings |
| ❌ Configurar certificados en cada caja | ✅ Plug & play |
| ✅ WebAuthn funcional | ✅ WebAuthn funcional |

## 🔧 Troubleshooting

### Error: Port already in use
```bash
lsof -i :3001
kill -9 <PID>
```

### Verificar servidor funcionando
```bash
curl http://localhost:3001/api/status
# {"status":"ok","database":"sqlite",...}
```

---

**Actualizado:** 2026-02-09
