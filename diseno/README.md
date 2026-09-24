# Propuesta visual · Ambientes SENA

Prototipo navegable del login y el dashboard administrativo sobre fondo
blanco, con tokens y guía de handoff. Ya está integrado en la app
(rediseño móvil v1: `../css/tokens.css`, `../css/movil.css`, login y panel
administrativo); esta carpeta queda como referencia de diseño.

Abrir con XAMPP:

- `http://localhost/sena-ambientes/diseno/prototipo.html`: flujo login → dashboard
  (demo: documento de 6+ dígitos y contraseña `Sena2026*`; otra contraseña muestra el error).
- `http://localhost/sena-ambientes/diseno/guia.html`: tokens, estados de componentes,
  tiempos y curvas, medidas, contraste por componente y assets.

| Archivo | Contenido |
|---|---|
| `tokens.css` | Variables CSS: primitivos → semánticos (color, tipo, espaciado, radios, sombras, movimiento) |
| `tokens.json` | Los mismos tokens en formato W3C Design Tokens (Figma / Tokens Studio) |
| `componentes.css` | Botón, campo flotante, selector de rol, tarjeta, chip, barra, nav, avatar y toast, con sus estados |
| `prototipo.*` | Pantallas y animaciones (sin dependencias; WAAPI + CSS) |
| `assets/` | SVG: piezas del fondo, trazos, ilustración de estado vacío y sprite de íconos |

Pendiente: fotos reales de los ambientes en `assets/fotos/` (se asignan
con `style="--foto:url(...)"` en `.amb__foto`).
