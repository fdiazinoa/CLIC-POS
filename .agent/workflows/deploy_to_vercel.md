---
description: Guía para desplegar el proyecto en Vercel
---

# Desplegar en Vercel

Este proyecto es una aplicación React construida con Vite. Vercel es una excelente opción para desplegarla de forma gratuita y rápida.

## Prerrequisitos

1.  Tener una cuenta en [Vercel](https://vercel.com).
2.  Tener el código subido a un repositorio de GitHub (recomendado).

## Opción 1: Despliegue automático desde GitHub (Recomendado)

1.  Ve a tu dashboard de Vercel y haz clic en **"Add New..."** -> **"Project"**.
2.  Selecciona tu repositorio de GitHub donde está alojado este proyecto (`CLIC-POS`).
3.  Vercel detectará automáticamente que es un proyecto **Vite**.
4.  En la configuración del proyecto:
    *   **Framework Preset**: Vite
    *   **Root Directory**: `./` (o déjalo vacío si está en la raíz)
    *   **Environment Variables**: Si usas variables de entorno (como `GEMINI_API_KEY`), agrégalas aquí.
        *   Nombre: `GEMINI_API_KEY`
        *   Valor: `tu_api_key_aqui`
5.  Haz clic en **"Deploy"**.

## Opción 2: Despliegue desde la terminal (CLI)

Si prefieres hacerlo desde la línea de comandos:

1.  Instala Vercel CLI globalmente:
    ```bash
    npm i -g vercel
    ```

2.  Inicia sesión en Vercel:
    ```bash
    vercel login
    ```

3.  Ejecuta el comando de despliegue en la carpeta del proyecto:
    ```bash
    vercel
    ```
    *   Sigue las instrucciones en pantalla (acepta los valores por defecto generalmente).

4.  Para desplegar a producción:
    ```bash
    vercel --prod
    ```

## Configuración Adicional

Se ha creado un archivo `vercel.json` en la raíz del proyecto para manejar el enrutamiento de la aplicación (SPA), asegurando que todas las rutas redirijan a `index.html` para que React Router funcione correctamente al recargar la página.

```json
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```
