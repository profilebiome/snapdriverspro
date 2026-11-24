# Arquitectura de Snap Drivers Pro

Tres capas con una sola frontera de privilegios: el renderer pinta y pide, el proceso principal habla con Windows.

## Vista general

```
┌ renderer (HTML/CSS/JS, sandbox, sin Node) ───────────────┐
│  estado + filtros + detalle + rutas + ajustes            │
└───────────────▲──────────────────────────────────────────┘
                │ window.dup.<canal>()  (preload, contextBridge, allowlist)
┌───────────────▼──────────────────────────────────────────┐
│ main (Node): ipc.js  →  scan / verdict / catalog / links │
│                      →  installer / report / settings    │
└───────┬──────────────────────────────┬───────────────────┘
        │ spawn PowerShell (JSON)      │ spawn pnputil (elevado)
        ▼                              ▼
  Win32_PnPSignedDriver            UAC → pnputil /add-driver
  Win32_PnPEntity / ComputerSystemProduct
  Microsoft.Update.Session
```

## Módulos y límites

| Módulo | Posee | No hace |
| --- | --- | --- |
| `src/main/scan.js` | Ejecutar los scripts PowerShell, validar su JSON y normalizar fechas/IDs | Decidir veredictos ni pintar |
| `src/main/scripts/*.ps1` | Toda la conversación con WMI/COM; salida JSON por stdout | Interpretar, formatear, elegir enlaces |
| `src/main/catalog.js` | Cargar/validar `data/latest-versions.json` y el catálogo del usuario | Comparar versiones |
| `src/main/verdict.js` | Veredicto puro, matching por hardware ID y comparación de versiones | Tocar el sistema o la red |
| `src/main/links.js` | Rutas oficiales: chip por clase, OEM por equipo, catálogo por hardware ID; lista blanca de hosts | Abrir el navegador |
| `src/main/catalog-download.js` | Descarga oficial desde el Catálogo de Microsoft: búsqueda con variantes y reintentos, dos analizadores, caché de 24 h, descarga con progreso y extracción del CAB | Elegir por el usuario ni instalar |
| `src/main/installer.js` | Punto de restauración, elevación, `pnputil` (simple y por lotes con un solo UAC), validación de ruta | Elegir el paquete por el usuario |
| `src/main/report.js` | Render de informe HTML/CSV/JSON desde el modelo ya calculado | Volver a escanear |
| `src/main/settings.js` / `paths.js` | Persistencia en carpeta portable con reserva al perfil | Lógica de dominio |
| `src/main/ipc.js` | Canales, validación de argumentos, errores serializables | Implementar dominio |
| `src/preload/preload.js` | API mínima y congelada | Acceso genérico a `ipcRenderer` |
| `src/renderer/*` | Estado de vista, filtros, acciones y feedback | Ejecutar comandos, leer archivos, red |

`scan.js` + `verdict.js` + `links.js` son deterministas y sin Electron: se prueban con fixtures en `test/`.

## Contrato de datos

```ts
System {
  manufacturer, model, productVersion, serial, boardVendor, boardProduct: string
  biosVersion, biosDate: string
  osCaption, osBuild, displayVersion, architecture, ramGb, cpu, isAdmin
}
Driver {
  key, deviceName, deviceId, className, provider, manufacturer, infName, status
  hardwareIds: string[]   // normalizados a minúsculas
  driverVersion, driverDate, errorCode, isSoftware, isPresent, installed
}
WuDriverUpdate { updateId, title, model, provider, driverClass, driverDate, sizeBytes, hardwareIds, catalogUrl }
Verdict { level: 'update'|'current'|'review'|'unknown'|'error', source, reason, latestVersion, updateId }
Route { id: 'chip'|'oem'|'catalog'|'wu', label, url, note, primary }
DriverLinks { vendor, oem, catalogUrl, catalogQuery, windowsUpdateUrl, serial, routes: Route[] }
```

`routes` es la única fuente de verdad de la UI: la primera es la primaria y el renderer no decide URLs.

## Decisiones

- **Windows Update como fuente primaria.** Es la única fuente oficial que sabe *para este equipo* si existe
  un paquete más nuevo, y llega con hardware IDs verificables (`ServerSelection = ssWindowsUpdate`,
  `SearchScope = 1`, `IsInstalled=0 and Type='Driver'`).
- **Catálogo local, no base de datos.** JSON pequeño por fabricante + clase + patrón. Compara versiones
  numéricamente; sin entrada devuelve `unknown`, nunca un falso «al día». Ver
  [ADR 0001](docs/adr/0001-sin-base-de-datos-de-drivers.md).
- **Autoridad por clase.** El OEM manda en clases del sistema (chipset, audio, touchpad, lector,
  almacenamiento, cámara, BIOS) y el fabricante del chip en gráficos, red, Bluetooth y periféricos. Las dos
  rutas se emiten siempre; `primary` decide el orden. Evita romper funciones del portátil con paquetes
  genéricos.
- **Identidad del equipo desde WMI.** `Win32_ComputerSystemProduct` (versión de producto y número de serie)
  y `Win32_BaseBoard` alimentan la ruta del OEM. Se muestran y se copian; nunca salen del equipo.
- **Enlaces, no scraping masivo.** Las URLs de los fabricantes son constantes del código; la lista blanca de
  hosts se **deriva de esas mismas tablas** y una prueba comprueba que toda URL oficial es abrible y que
  ningún host ajeno lo es.
- **Descarga puntual desde el Catálogo de Microsoft.** Sin API pública, el módulo reproduce las dos
  peticiones de la web oficial (búsqueda por hardware ID y diálogo de descarga) y acepta solo HTTPS en
  hosts `*.download.windowsupdate.com`, con tope de 900 MB y verificación de cabecera CAB. El `.cab` se
  extrae con `%SystemRoot%System32expand.exe` (nunca el `expand` del PATH, que en equipos con Git Bash
  es el de GNU) y el resultado se marca como ruta aprobada para `pnputil`.
- **Emparejar por hardware ID.** Normalización tolerante a `VEN_/DEV_` vs `VID/PID`, `&SUBSYS`, `&REV` y
  `&CC`; el fallback por nombre de modelo solo aplica si el dispositivo no tiene ningún hardware ID y exige
  coincidencia exacta.
- **Elevación acotada.** Solo `installer.js` eleva, y solo con una ruta ya elegida en el diálogo nativo. La
  línea de argumentos viaja como literal de PowerShell (sin expandir `$`, backtick ni `$()`).
- **Cancelación real.** El token de escaneo descarta eventos tardíos y `killAll()` termina los hijos; cada
  descarga tiene su `AbortSignal` y su `.part` propio.
- **Actualización por lotes con un solo permiso.** La app descarga y extrae en cola y luego ejecuta
  `install-batch.ps1` una sola vez con un manifiesto JSON; el resultado por dispositivo vuelve al renderer.
- **Resiliencia del catálogo.** Variantes de hardware ID, reintentos con espera, segundo analizador que no
  depende de la tabla y caché en disco de 24 h: si Microsoft cambia el HTML, la app conserva la última
  lista conocida en lugar de fallar.
- **Firma opcional.** `electron-builder` firma el ejecutable automáticamente si el entorno define
  `CSC_LINK` y `CSC_KEY_PASSWORD`; sin certificado, SmartScreen avisará (limitación de Windows, no del
  binario).
- **Sin `contextIsolation: false` ni `nodeIntegration: true`.** Renderer sin Node, API de preload con lista
  blanca y CSP sin `connect-src`.

## Riesgos y mitigación

| Riesgo | Mitigación |
| --- | --- |
| Windows Update deshabilitado o lento | Timeout de 210 s, aviso legible; catálogo y antigüedad siguen funcionando |
| Driver sin catálogo ni paquete WU | Etiqueta «Sin datos · revisar en fabricante», nunca «al día» |
| `pnputil` rechaza el paquete | Código de salida y salida cruda visibles; modo carpeta con reserva .inf por .inf en Windows antiguos |
| Hardware sin VID reconocido | Igual hay búsqueda en el Catálogo de Microsoft Update por hardware ID |
| Catálogo desactualizado | Editable, con fecha de revisión por entrada |
| Windows en ARM64 | Aviso de emulación y ruta al OEM, que es quien publica paquetes ARM64 |
| Ruta del `.exe` con espacios, `# Arquitectura de Snap Drivers Pro

Tres capas con una sola frontera de privilegios: el renderer pinta y pide, el proceso principal habla con Windows.

## Vista general

```
┌ renderer (HTML/CSS/JS, sandbox, sin Node) ───────────────┐
│  estado + filtros + detalle + rutas + ajustes            │
└───────────────▲──────────────────────────────────────────┘
                │ window.dup.<canal>()  (preload, contextBridge, allowlist)
┌───────────────▼──────────────────────────────────────────┐
│ main (Node): ipc.js  →  scan / verdict / catalog / links │
│                      →  installer / report / settings    │
└───────┬──────────────────────────────┬───────────────────┘
        │ spawn PowerShell (JSON)      │ spawn pnputil (elevado)
        ▼                              ▼
  Win32_PnPSignedDriver            UAC → pnputil /add-driver
  Win32_PnPEntity / ComputerSystemProduct
  Microsoft.Update.Session
```

## Módulos y límites

| Módulo | Posee | No hace |
| --- | --- | --- |
| `src/main/scan.js` | Ejecutar los scripts PowerShell, validar su JSON y normalizar fechas/IDs | Decidir veredictos ni pintar |
| `src/main/scripts/*.ps1` | Toda la conversación con WMI/COM; salida JSON por stdout | Interpretar, formatear, elegir enlaces |
| `src/main/catalog.js` | Cargar/validar `data/latest-versions.json` y el catálogo del usuario | Comparar versiones |
| `src/main/verdict.js` | Veredicto puro, matching por hardware ID y comparación de versiones | Tocar el sistema o la red |
| `src/main/links.js` | Rutas oficiales: chip por clase, OEM por equipo, catálogo por hardware ID; lista blanca de hosts | Abrir el navegador |
| `src/main/catalog-download.js` | Descarga oficial desde el Catálogo de Microsoft: búsqueda por hardware ID, URL del paquete, descarga con progreso y extracción del CAB | Elegir por el usuario ni instalar |
| `src/main/installer.js` | Punto de restauración, elevación, `pnputil`, validación de ruta | Elegir el paquete por el usuario |
| `src/main/report.js` | Render de informe HTML/CSV/JSON desde el modelo ya calculado | Volver a escanear |
| `src/main/settings.js` / `paths.js` | Persistencia en carpeta portable con reserva al perfil | Lógica de dominio |
| `src/main/ipc.js` | Canales, validación de argumentos, errores serializables | Implementar dominio |
| `src/preload/preload.js` | API mínima y congelada | Acceso genérico a `ipcRenderer` |
| `src/renderer/*` | Estado de vista, filtros, acciones y feedback | Ejecutar comandos, leer archivos, red |

`scan.js` + `verdict.js` + `links.js` son deterministas y sin Electron: se prueban con fixtures en `test/`.

## Contrato de datos

```ts
System {
  manufacturer, model, productVersion, serial, boardVendor, boardProduct: string
  biosVersion, biosDate: string
  osCaption, osBuild, displayVersion, architecture, ramGb, cpu, isAdmin
}
Driver {
  key, deviceName, deviceId, className, provider, manufacturer, infName, status
  hardwareIds: string[]   // normalizados a minúsculas
  driverVersion, driverDate, errorCode, isSoftware, isPresent, installed
}
WuDriverUpdate { updateId, title, model, provider, driverClass, driverDate, sizeBytes, hardwareIds, catalogUrl }
Verdict { level: 'update'|'current'|'review'|'unknown'|'error', source, reason, latestVersion, updateId }
Route { id: 'chip'|'oem'|'catalog'|'wu', label, url, note, primary }
DriverLinks { vendor, oem, catalogUrl, catalogQuery, windowsUpdateUrl, serial, routes: Route[] }
```

`routes` es la única fuente de verdad de la UI: la primera es la primaria y el renderer no decide URLs.

## Decisiones

- **Windows Update como fuente primaria.** Es la única fuente oficial que sabe *para este equipo* si existe
  un paquete más nuevo, y llega con hardware IDs verificables (`ServerSelection = ssWindowsUpdate`,
  `SearchScope = 1`, `IsInstalled=0 and Type='Driver'`).
- **Catálogo local, no base de datos.** JSON pequeño por fabricante + clase + patrón. Compara versiones
  numéricamente; sin entrada devuelve `unknown`, nunca un falso «al día». Ver
  [ADR 0001](docs/adr/0001-sin-base-de-datos-de-drivers.md).
- **Autoridad por clase.** El OEM manda en clases del sistema (chipset, audio, touchpad, lector,
  almacenamiento, cámara, BIOS) y el fabricante del chip en gráficos, red, Bluetooth y periféricos. Las dos
  rutas se emiten siempre; `primary` decide el orden. Evita romper funciones del portátil con paquetes
  genéricos.
- **Identidad del equipo desde WMI.** `Win32_ComputerSystemProduct` (versión de producto y número de serie)
  y `Win32_BaseBoard` alimentan la ruta del OEM. Se muestran y se copian; nunca salen del equipo.
- **Enlaces, no scraping masivo.** Las URLs de los fabricantes son constantes del código; la lista blanca de
  hosts se **deriva de esas mismas tablas** y una prueba comprueba que toda URL oficial es abrible y que
  ningún host ajeno lo es.
- **Descarga puntual desde el Catálogo de Microsoft.** Sin API pública, el módulo reproduce las dos
  peticiones de la web oficial (búsqueda por hardware ID y diálogo de descarga) y acepta solo HTTPS en
  hosts `*.download.windowsupdate.com`, con tope de 900 MB y verificación de cabecera CAB. El `.cab` se
  extrae con `%SystemRoot%System32expand.exe` (nunca el `expand` del PATH, que en equipos con Git Bash
  es el de GNU) y el resultado se marca como ruta aprobada para `pnputil`.
- **Emparejar por hardware ID.** Normalización tolerante a `VEN_/DEV_` vs `VID/PID`, `&SUBSYS`, `&REV` y
  `&CC`; el fallback por nombre de modelo solo aplica si el dispositivo no tiene ningún hardware ID y exige
  coincidencia exacta.
- **Elevación acotada.** Solo `installer.js` eleva, y solo con una ruta ya elegida en el diálogo nativo. La
  línea de argumentos viaja como literal de PowerShell (sin expandir `$`, backtick ni `$()`).
- **Cancelación real.** El token de escaneo descarta eventos tardíos y `killAll()` termina los hijos.
- **Sin `contextIsolation: false` ni `nodeIntegration: true`.** Renderer sin Node, API de preload con lista
  blanca y CSP sin `connect-src`.

## Riesgos y mitigación

| Riesgo | Mitigación |
| --- | --- |
| Windows Update deshabilitado o lento | Timeout de 210 s, aviso legible; catálogo y antigüedad siguen funcionando |
| Driver sin catálogo ni paquete WU | Etiqueta «Sin datos · revisar en fabricante», nunca «al día» |
| `pnputil` rechaza el paquete | Código de salida y salida cruda visibles; modo carpeta con reserva .inf por .inf en Windows antiguos |
| Hardware sin VID reconocido | Igual hay búsqueda en el Catálogo de Microsoft Update por hardware ID |
| Catálogo desactualizado | Editable, con fecha de revisión por entrada |
| Windows en ARM64 | Aviso de emulación y ruta al OEM, que es quien publica paquetes ARM64 |
 o en carpeta de solo lectura | Argumentos como array, rutas entrecomilladas y reserva a `%APPDATA%` |
| Microsoft cambia el HTML del catálogo | La búsqueda devuelve 0 resultados y se informa; las rutas al navegador siguen operativas |
| Paquete descargado corrupto o ajeno | Cabecera `MSCF`, host de Microsoft y tope de tamaño antes de usarlo |
