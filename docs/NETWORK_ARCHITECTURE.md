# Arquitectura de Red CLIC-POS

## Esquema Multi-Tienda

### Topología General

**CLIC-POS** implementa una arquitectura distribuida de comercio multi-tienda con las siguientes características:

- 🏪 **Multi-Tienda**: Múltiples sucursales independientes
- 💵 **Multi-Caja**: Cada tienda tiene varias cajas/terminales (t1, t2, t3...)
- 📦 **Multi-Almacén**: Gestión de inventario por sucursal
- ☁️ **ERP Cloud**: Sistema central en la nube para sincronización

### Diagrama de Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                         ERP CLOUD (HTTPS)                       │
│                      api.miempresa.com                          │
└────────────────────────┬────────────────────┬───────────────────┘
                         │                    │
                      HTTPS                HTTPS
                         │                    │
┌────────────────────────┴──────┐   ┌────────┴────────────────────┐
│      Tienda 1 - Local         │   │    Tienda 2 - Local         │
│      Red 192.168.1.x          │   │    Red 192.168.2.x          │
│  ┌──────────────────────────┐ │   │ ┌──────────────────────────┐│
│  │ Terminal t1 (Master)     │ │   │ │ Terminal t1 (Master)     ││
│  │ 192.168.1.100:3001       │ │   │ │ 192.168.2.100:3001       ││
│  │ - HTTP Server            │ │   │ │ - HTTP Server            ││
│  │ - SQLite Database        │ │   │ │ - SQLite Database        ││
│  └────────┬─────────────────┘ │   │ └──────────────────────────┘│
│           │                   │   │                              │
│      HTTP │                   │   │                              │
│  ┌────────┴────┬──────────┐   │   │                              │
│  │             │          │   │   │                              │
│  ▼             ▼          ▼   │   │                              │
│ t2           t3         t4    │   │                              │
└───────────────────────────────┘   └──────────────────────────────┘
```

## Comunicación de Red

### 1. Red Local (Intra-Tienda) - HTTP

**Configuración:**
- **Protocolo**: HTTP (sin SSL)
- **Puerto**: 3001
- **Host**: 0.0.0.0 (escucha en todas las interfaces)
- **Comunicación**: Cajas ↔ Caja Master (t1)

**Ventajas:**
- ✅ Sin complejidad de certificados SSL
- ✅ Configuración simple y directa
- ✅ Mayor velocidad en red local
- ✅ Sin problemas de certificados autofirmados

**Ejemplo de comunicación:**
```bash
# Terminal t2 consulta inventario en t1
curl http://192.168.1.100:3001/api/products
```

### 2. Conexión al ERP Cloud - HTTPS

**Configuración:**
- **Protocolo**: HTTPS (TLS 1.2+)
- **Autenticación**: API Key / JWT
- **Certificado**: Let's Encrypt o certificado válido
- **Función**: Sincronización centralizada

**Flujo de datos:**
1. Caja Master (t1) acumula transacciones locales
2. Sincroniza periódicamente con ERP Cloud
3. Recibe actualizaciones de configuración/productos
4. Envía reportes financieros (Z-Reports)

**Ejemplo:**
```typescript
// Sincronización con cloud
fetch('https://api.miempresa.com/sync', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(localTransactions)
});
```

## Seguridad

### WebAuthn / Autenticación Biométrica

**Contexto Seguro sin HTTPS:**
- `localhost` es considerado "contexto seguro" por navegadores
- WebAuthn funciona perfectamente en aplicaciones empaquetadas (APK/EXE)
- **No requiere HTTPS** para red local

**Browsers compatibles:**
- ✅ Chrome/Edge: Soportan WebAuthn en localhost
- ✅ Safari: Soporta WebAuthn en localhost
- ✅ Firefox: Soporta WebAuthn en localhost

### Certificados SSL

| Entorno | Protocolo | Certificado |
|---------|-----------|-------------|
| Red Local | HTTP | No requerido |
| ERP Cloud | HTTPS | Let's Encrypt / Comercial |
| Desarrollo | HTTP | No requerido |

## Configuración

### Variables de Entorno

Archivo `.env`:

```env
# Modo Local (HTTP)
CLOUD_MODE=false
PORT=3001
HOST=0.0.0.0

# Modo Cloud (HTTPS) - Solo para ERP central
# CLOUD_MODE=true
# SSL_KEY_PATH=/etc/letsencrypt/live/yourdomain.com/privkey.pem
# SSL_CERT_PATH=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
```

### Inicio del Servidor

**Modo Local (Default):**
```bash
npm run server
# 🚀 Local Server (HTTP) running on http://0.0.0.0:3001
```

**Modo Cloud (ERP):**
```bash
CLOUD_MODE=true npm run server
# 🔒 Cloud Server (HTTPS) running on https://0.0.0.0:3001
```

## Estrategia de Despliegue y Escalamiento

CLIC-POS soporta dos modelos de despliegue según las necesidades del cliente:

### 1. Modelo SaaS (Cloud Centralizado)
Recomendado para cadenas con múltiples sucursales y gestión centralizada.

- **Infraestructura Cloud**: Un único cluster de servidores (ERP) atiende a todos los tenants (multi-tenant).
- **Aislamiento de Datos**: Lógico, mediante `mall_id` en todas las tablas (`RLS` en Supabase).
- **Ventajas**: Menor costo de mantenimiento, actualizaciones automáticas, despliegue rápido de nuevas tiendas.

### 2. Modelo On-Premise / Híbrido
Para clientes con requisitos estrictos de soberanía de datos o conectividad limitada.

- **Infraestructura**: Servidor ERP dedicado en la nube privada del cliente o en su datacenter.
- **Ventajas**: Control total de datos, personalización profunda.

### Arquitectura "Offline-First"
Independientemente del modelo, las tiendas operan bajo el principio **Offline-First**:
- La operación de venta (POS) es 100% local en `t1` (Master).
- La caída de internet NO detiene la venta.
- La sincronización ocurre en segundo plano cuando la conexión se restablece.

## Proceso de Onboarding de Nuevas Tiendas

Pasos técnicos para dar de alta una nueva sucursal (`mall_id`):

1.  **Creación de Tenant (Cloud)**:
    - Ejecutar script administrativo para insertar en `malls` y `usuarios_malls`.
    - Generar API Key o credenciales de admin para la nueva tienda.

2.  **Preparación del Master (Local)**:
    - Instalar CLIC-POS en el equipo designado como servidor (`t1`).
    - Configurar `.env` con el `MALL_ID` y credenciales de usuario administrador.
    - Inicializar base de datos local: `npm run db:init`.

3.  **Vinculación de Terminales**:
    - Conectar `t2`, `t3`... a la red local.
    - En cada esclavo, navegar a `http://IP_MASTER:3001`.
    - Autorizar dispositivo desde el Master (Ajustes -> Dispositivos).

## Estrategia de Replicación de Datos

La sincronización garantiza la consistencia eventual entre el borde (Edge/Tienda) y la nube (Cloud).

### Flujo: Tienda -> Nube (Push)
- **Frecuencia**: Casi en tiempo real (cada 5-30s) o activado por eventos (cierre de ticket).
- **Datos**: 
  - `transactions` (Ventas finalizadas)
  - `inventory_ledger` (Movimientos de stock)
  - `z_reports` (Cortes de caja)
  - `clients` (Nuevos clientes registrados localmente)

### Flujo: Nube -> Tienda (Pull)
- **Frecuencia**: Polling periódico o bajo demanda (botón "Sincronizar").
- **Datos**:
  - `products` (Catálogo maestro, precios)
  - `promotions` (Reglas de negocio globales)
  - `users` (Nuevos empleados)
  - `config` (Configuraciones de la tienda)

---

**Última actualización:** 2026-02-09
**Versión:** 1.1.0
