# Riders Miami CRM

CRM + bot de Telegram + asistente de WhatsApp para Riders Miami (venta de motos/scooters).
Dueño: Octa (GitHub: Octavioff7, repo `riders-crm`).

## Producción (lo que usan los vendedores)
- https://riders-crm-xtev.onrender.com — Render, servicio `riders-crm`, región Ohio.
- Auto-deploy: cada push a `main` en GitHub se publica solo en 1-2 min.
- Datos en disco persistente de Render montado en `/data` (env `DATA_DIR=/data`). Un deploy NO borra datos.
  Render saca una foto del disco cada 24 h (7 días de retención).
- Secretos en variables de entorno de Render: TELEGRAM_TOKEN, GEMINI_KEY, GEMINI_MODEL, ADMIN_USER, ADMIN_PASS, ADMIN_CHAT_ID.

## Stack
- Node.js puro (`server.js`), sin framework ni build. Única dependencia: `web-push`.
- Frontend: `index.html` (una sola página, ~4800 líneas) + `sw.js` + `manifest.json` (PWA).
  Al cambiar `index.html` conviene subir el número de `CACHE` en `sw.js` para que los celulares refresquen.
- `asistente.js`: asistente de WhatsApp para leads de anuncios de Facebook.

## Cómo correr en esta Mac (solo desarrollo)
- `npm start` (o doble clic en `INICIAR-CRM.command`). Abre http://localhost:8790.
- Node está en `~/.local/node`, `gh` en `~/.local/gh` (instalados sin admin). PATH: `~/.local/bin`.
- El `config.json` local tiene el token de Telegram VACÍO a propósito: si se pone, el bot local se pisa
  con el de Render (Telegram permite un solo lector). El config completo está en `backups/config.completo.json`.
- Datos locales: copia de agosto 2026 (25 clientes), solo para probar. Los reales están en Render.

## Cómo publicar cambios (sin git en esta Mac)
- `git` no funciona: faltan Command Line Tools (`xcode-select --install`, requiere admin).
- Se publica con `gh api` (Git Data API: blobs → tree → commit → ref main), ya autenticado como Octavioff7.
  Último commit así: c1d6c5d (2026-09-13). Si algún día hay git: `git init`, remote a GitHub y listo.
- Esta carpeta se bajó como zip del repo (main, 2026-09-08) y no es un clon git.

## Convenciones
- Todo en español (UI, comentarios, commits). Commits con "Co-Authored-By: Claude ...".
- Datos = JSON planos en `DATA_DIR`; el server los crea si no existen. Nunca subir datos ni config a GitHub (.gitignore).
- En la ficha (`crmHTML`), notas y aviso de próximo contacto se redibujan solos con `refrescarFicha(c)`;
  evitar `renderInboxKeepScroll()` cuando el usuario puede tener texto sin guardar.
