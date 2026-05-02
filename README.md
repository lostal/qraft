# Qraft: Generador de códigos QR con identidad de marca

![Icon](/public/favicon.svg)

**Qraft** es un generador de códigos QR que extrae automáticamente los colores y el favicon de cualquier web para producir códigos visualmente alineados con la marca — sin backend, sin cuenta, sin almacenamiento de datos.

## El problema

Los códigos QR genéricos son intercambiables visualmente. Qraft resuelve esto extrayendo la identidad visual de cualquier URL y aplicándola directamente al resultado: el color dominante se convierte en el color de los puntos, el favicon se incrusta en el código y el fondo se adapta al tono más claro de la paleta extraída.

## Dos modos de generación

**Favicon en el centro** utiliza `qr-code-styling` para renderizar un QR estándar con el favicon centrado dentro de la zona de silencio, aprovechando la corrección de errores de nivel H para mantener la legibilidad con un 30% de la imagen cubriendo el código.

**Favicon como puntos** reemplaza los módulos de datos centrales con un bitmap binarizado del favicon mediante un pipeline de renderizado propio. El bitmap se umbraliza con el método de Otsu a 64×64 píxeles y se mapea módulo a módulo, preservando siempre los patrones de búsqueda y los marcadores de alineación — los elementos estructurales de los que depende cualquier decodificador QR.

## Extracción de color

ColorThief muestrea 8 colores del favicon (obtenido a 256×256 a través de la API de favicons de Google, con proxy en wsrv.nl para CORS). La paleta se filtra por ratio de contraste respecto al fondo, se deduplica por proximidad de luminancia y se limita a 4 opciones utilizables. El color de mayor contraste se selecciona automáticamente.

## Stack técnico

- **Framework**: Astro 4 con isla React para el generador interactivo
- **Estilos**: Tailwind CSS v3, tokens de diseño propios, JetBrains Mono + Fraunces
- **Renderizado QR**: `qrcode-generator` (matriz base), `qr-code-styling` (modo central)
- **Extracción de color**: ColorThief + lógica propia de contraste y deduplicación
- **Proxy de imagen**: wsrv.nl (CORS + normalización de formato)
- **Exportación**: PNG vía Canvas API, SVG mediante serialización programática

## Exportación

Ambos modos exportan a PNG y SVG. El SVG artístico se genera a 1000×1000 de forma independiente al canvas de previsualización, garantizando calidad de impresión. Las object URLs se revocan inmediatamente tras la descarga para evitar acumulación de memoria.

## Ejecución local

```bash
npm install
npm run dev
```

Compila a salida estática con `npm run build`. No requiere variables de entorno.

---

Hecho por [Álvaro Lostal](https://lostal.dev)
