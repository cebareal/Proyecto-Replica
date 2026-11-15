# Hilo — app de hábitos personal (PWA)

HTML + CSS + JavaScript sin dependencias. Los datos se guardan solo en el dispositivo (IndexedDB).

## Probar en el PC

```bash
python -m http.server 8765 --directory app
```

Abre http://localhost:8765

## Archivos

| archivo | qué es |
| --- | --- |
| `index.html` | página y barra inferior |
| `app.js` | pantallas (Hoy, Editar, Detalle, Estadísticas, Ajustes) y acciones |
| `logic.js` | fechas, rachas, porcentajes y exportación `.ics` |
| `db.js` | IndexedDB |
| `sw.js` | funcionamiento sin conexión (primero red, luego caché) |
| `manifest.webmanifest`, `icons/` | instalación; iconos generados con `tools/make_icons.py` |

## Llevarla al iPhone

Necesita HTTPS. Sube la carpeta `app/` tal cual a un hosting estático (GitHub Pages,
Cloudflare Pages o Netlify). Luego, en Safari en el iPhone: Compartir → **Añadir a pantalla de inicio**.

## Recordatorios

iOS no deja a una app web programar avisos locales. En Ajustes → **Exportar recordatorios (.ics)**
se genera un calendario con eventos repetidos y alarma; ábrelo en el iPhone para añadirlo a Calendario.

## Copia de seguridad

Ajustes → Exportar copia (.json). Si borras la app de la pantalla de inicio o los datos de Safari,
se pierden los datos que no hayas exportado.
