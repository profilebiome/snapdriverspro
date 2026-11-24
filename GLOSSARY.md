# Glosario — Snap Drivers Pro

Términos del dominio tal como los usa este producto. Sin detalles de implementación.

## Dispositivo

Hardware que Windows enumera en el árbol PnP (una GPU, un controlador USB, un teclado). Tiene un
identificador de instancia y uno o varios **hardware IDs**. Un mismo equipo físico puede aparecer como
varios dispositivos (una GPU con su función de audio, por ejemplo).

## Controlador (driver)

Software que Windows carga para operar un dispositivo. En este producto distinguimos siempre dos cosas:

- **Controlador instalado**: lo que hay hoy en el equipo. Tiene versión, fecha, proveedor, firma e INF.
- **Paquete de controlador**: el archivo que el fabricante publica (`.inf`, `.exe`, `.cab`). Es lo que se
  descarga y se instala.

Que exista un paquete más nuevo no implica que el instalado esté mal: el veredicto siempre se refiere a la
versión instalada.

## Hardware ID

Cadena que identifica al dispositivo para Windows y para el Catálogo de Microsoft Update
(`PCI\VEN_8086&DEV_0152…`). Es la llave de búsqueda: no depende del nombre comercial ni del idioma.

## Veredicto

Clasificación de un controlador instalado, siempre con la **fuente** que lo justifica:

- **Actualizar** — existe un paquete más nuevo aplicable (Windows Update o catálogo de referencia).
- **Con error** — Windows reporta un código de problema en el dispositivo.
- **Revisar** — controlador de terceros antiguo y sin versión de referencia: puede estar al día, pero no se
  puede afirmar.
- **Al día** — la versión instalada es igual o posterior a la referencia, o el controlador lo publica
  Microsoft con Windows.
- **Sin datos** — no hay referencia ni antigüedad suficiente. No significa «correcto».

## Fuente

De dónde sale el veredicto: `windows-update`, `catalog`, `age` o ninguna. Un «al día» sin fuente es
imposible: siempre se muestra por qué.

## Catálogo de referencia

Lista local y editable de familias de componentes con la última versión conocida. Es el único sitio donde
el producto guarda una cifra de versión, y solo si una persona la escribió tras verla en la web oficial.
Sin entrada, no hay comparación.

## Ruta oficial

Enlace a la página del fabricante que corresponde abrir para ese dispositivo, en este orden de autoridad:

- **Fabricante del equipo (OEM)** — manda en clases del sistema: chipset, audio, touchpad, lector,
  almacenamiento, cámara, BIOS y utilidades del portátil.
- **Fabricante del componente (chip)** — manda en gráficos, red, Bluetooth y periféricos.
- **Catálogo de Microsoft Update** — paquetes publicados por Microsoft para ese hardware ID.
- **Windows Update** — la vía del sistema.

## OEM

Quien vende el equipo completo y responde por él (Lenovo, Dell/Alienware, HP/OMEN, ASUS/ROG, Acer/Predator,
MSI, Razer…). No es lo mismo que el fabricante del chip que va dentro.

## Escaneo

Lectura de solo lectura del equipo: dispositivos, controladores instalados, sus versiones y lo que ofrece
Windows Update. No instala, no descarga y no modifica nada.

## Al día (definición estricta)

«La versión instalada es igual o posterior a la única referencia que tenemos». No es una garantía del
fabricante ni una comprobación contra su web en tiempo real.
