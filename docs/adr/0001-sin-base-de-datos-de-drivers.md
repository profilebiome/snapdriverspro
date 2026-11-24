# 0001 — Sin base de datos de controladores: rutas oficiales, catálogo de Microsoft y Windows Update

- **Estado**: aceptada (revisada al añadir la descarga desde el catálogo)
- **Fecha**: 2026-11-22

## Contexto

El producto nace como alternativa portable a utilidades comerciales que mantienen una base de datos
propia de millones de controladores, la actualizan a diario, sirven los binarios desde su propio CDN y
los instalan en silencio. Ese modelo es lo que permite afirmar «hay una versión más nueva» para cualquier
dispositivo de cualquier PC.

Un ejecutable portable de un solo archivo no puede replicarlo: no hay servidor, no hay contratos con
fabricantes, no hay firma de paquetes de terceros y no hay forma de mantener actualizado un índice que
cambia a diario.

## Decisión

1. **No empaquetamos ni mantenemos una base de datos de controladores.** No se copian binarios de terceros
   ni se alojan espejos.
2. El veredicto se apoya en fuentes que ya existen en el equipo o son oficiales:
   - Windows Update (COM), que sabe *para este equipo* si hay un paquete más nuevo, con hardware IDs.
   - Un catálogo local, editable y vacío por defecto, donde una persona anota la última versión que vio en
     la web oficial de una familia de componentes.
   - La antigüedad del controlador, como último recurso y siempre etiquetada como «Revisar».
3. Para descargar hay dos caminos, ambos oficiales:
   - **Abrir la ruta oficial** que corresponde al dispositivo: OEM del equipo en clases del sistema
     (chipset, audio, touchpad, almacenamiento, cámara, BIOS); fabricante del chip en gráficos, red,
     Bluetooth y periféricos; Catálogo de Microsoft Update por hardware ID.
   - **Descargar dentro de la app** el paquete que Microsoft publica para ese hardware ID, reproduciendo
     exactamente las dos peticiones que hace la web pública del Catálogo (búsqueda y diálogo de descarga),
     una sola vez por acción del usuario. El archivo se valida (host de Microsoft, HTTPS, tamaño máximo y
     cabecera CAB) antes de escribirse.
4. La instalación siempre es **manual y asistida**: el usuario confirma, se eleva solo esa operación y el
   paquete se aplica con `pnputil` (extraído de su CAB con `expand.exe`).

## Alternativas descartadas

- **Índice propio de descargas**: exige infraestructura, mantenimiento diario y alojar paquetes de
  terceros; cambia el proyecto de una herramienta portable a un servicio.
- **Scraping masivo de las webs de los fabricantes**: se rompe con cada rediseño, muchas bloquean bots y
  varias lo prohíben en sus términos. La descarga desde el Catálogo es una petición puntual a una web
  pública de Microsoft, no un rastreo.
- **Catálogo rellenado con versiones «conocidas» por el desarrollador**: envejece a los días y produce
  falsos «al día», precisamente el error que el producto quiere evitar.
- **Descarga e instalación en silencio**: imposible sin base de datos propia y sin firmar paquetes; además
  es la causa habitual de equipos rotos tras un «actualizador» automático.

## Consecuencias

- La app funciona igual en cualquier PC, sin servidor propio; el coste es que **no promete detectar todas
  las actualizaciones**: solo las que Windows Update ofrece y las que el catálogo conoce, más los paquetes
  que Microsoft publica en su catálogo para ese hardware ID.
- El catálogo de Microsoft **no tiene API documentada**: si Microsoft cambia su HTML, la descarga
  integrada deja de funcionar y la app lo dice con un error claro; las rutas al navegador siguen
  funcionando siempre.
- Cada descarga la inicia el usuario, un paquete a la vez. No hay rastreo ni descarga masiva.
- Si algún día se quiere cobertura total, el camino no es scraping: es un índice firmado, versionado y
  distribuido aparte, mantenido como un producto en sí mismo.
