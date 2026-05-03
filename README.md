# Qraft: Generador de códigos QR con identidad de marca

![Icon](public/cover.png)

**Qraft** es un generador QR estático y 100% cliente-side que extrae automáticamente los colores y el favicon de cualquier URL — sin backend, sin cuenta, sin datos guardados.

## Por qué existe

Un código QR genérico no dice nada de quien lo pone. Qraft coge la identidad visual de una URL y la aplica al código: el color principal pasa a ser el color de los puntos, el favicon se incrusta y el fondo se adapta al tono más claro de la paleta.

## Dos modos

**Favicon en el centro** — usa `qr-code-styling` con corrección de errores nivel H, que aguanta hasta un 30% de la superficie tapada sin perder legibilidad. El favicon va centrado en esa zona.

**Favicon como puntos** — los módulos centrales del QR se sustituyen por el favicon binarizado con umbralización de Otsu (64×64) en una zona protegida (~13% del área, dentro del presupuesto del 30% de EC nivel H). Respeta siempre los patrones de esquina y marcadores de alineación.

## Cómo se extraen los colores

El favicon se obtiene vía API de Google + proxy wsrv.nl (timeout 8s) para CORS. ColorThief extrae 8 colores; se filtran por contraste alto, se deduplicam por luminancia y quedan máx. 4. Se selecciona automáticamente el de mayor contraste.

## Stack

- **Framework**: Astro 4 (salida estática) + React 18 (isla client-only) + TypeScript strict
- **Estilos**: Tailwind CSS con paletas personalizadas (`ink`, `caoba`)
- **QR**: `qrcode-generator` + `qr-code-styling` (importados dinámicamente)
- **Colores**: ColorThief (importado dinámicamente)
- **Exportación**: PNG (múltiples resoluciones) y SVG (1000×1000)

## Correr en local

```bash
pnpm install
pnpm run dev      # Dev server con hot reload
pnpm run build    # Build estático a dist/
pnpm run preview  # Preview del build
```

No hace falta variables de entorno.

---

Hecho por [Álvaro Lostal](https://lostal.dev)
