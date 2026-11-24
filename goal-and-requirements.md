---
id: drivers-update-pro
type: goal-and-requirements
title: Snap Drivers Pro
status: draft
---

# Snap Drivers Pro

Un ejecutable portable que audita los controladores del PC, dice cuáles están desactualizados y lleva al usuario a la descarga oficial de cada componente.

## Overview

Snap Drivers Pro es una aplicación de escritorio portable para Windows 10/11 x64 que enumera todos los controladores instalados del equipo, cruza esa información con dos fuentes oficiales —Windows Update (API COM, categoría Drivers) y un catálogo local ampliable de últimas versiones— y presenta un veredicto por controlador. Desde cada fila el usuario abre la página oficial del fabricante, la búsqueda en el Catálogo de Microsoft Update por *hardware ID*, o instala un paquete `.inf` descargado con `pnputil`.

Reemplaza el ciclo manual de «Abrir Administrador de dispositivos → propiedades → detalles → buscar a mano en Google qué versión es la última», y sustituye a utilidades comerciales tipo IObit Driver Booster que exigen instalación, envían telemetría y descargan binarios desde su propio CDN en lugar de la web oficial del fabricante.

## Problem

Hoy, para saber si un driver está obsoleto hay que abrir el Administrador de dispositivos, leer versión y fecha controlador por controlador, y adivinar si lo que ofrece el fabricante es más nuevo. Nada en Windows indica «esto está desactualizado», el hardware ID no es legible para una persona y el modelo del equipo no siempre identifica al fabricante real del componente. El resultado: drivers de 2015 conviviendo con hardware de 2024, o gente instalando paquetes de webs de terceros que empaquetan adware.

## Target Users

- **Dueño del PC (no técnico)**: quiere saber si su equipo está al día sin entender de drivers; instala a mano con instrucciones claras.
- **Técnico / soporte**: recorre varios equipos, necesita un informe exportable y una vía rápida al paquete oficial correcto.

## Jobs to Be Done

- Cuando sospecho que mi PC rinde mal o un dispositivo falla, quiero ver de un vistazo qué controladores están viejos o con error, para decidir si vale la pena actualizar.
- Cuando un controlador tiene actualización, quiero llegar a la página oficial exacta de ese componente, para descargar el paquete correcto sin buscar a ciegas.
- Cuando ya tengo el paquete descargado, quiero instalarlo sin pelearme con `pnputil` ni con rutas, para terminar el trabajo en un clic.
- Cuando reviso un equipo ajeno, quiero exportar el estado de los controladores, para dejar constancia o comparar después.

## Key User Story

Un usuario abre `Snap Drivers Pro.exe` desde un pendrive. Pulsa **Escanear**. En ~15 s ve 106 controladores, 9 marcados «Actualización disponible (Windows Update)» y 14 marcados «Revisar en fabricante» por antigüedad. Filtra por «Actualizaciones», selecciona los 9 y pulsa **Abrir descargas oficiales**: se abren las fichas del Catálogo de Microsoft Update correspondientes a cada hardware ID. Vuelve a la app, pulsa **Instalar .inf**, elige la carpeta que descargó, confirma el aviso de elevación y `pnputil` aplica el paquete. Exporta el informe HTML y lo archiva.

## Goals

- Detectar y listar el 100 % de los controladores instalados que expone `Win32_PnPSignedDriver` en menos de 30 s.
- Dar un veredicto explícito para cada controlador, con la fuente del veredicto visible.
- Llevar del controlador a la descarga oficial en ≤ 2 clics, sin resultados de terceros.
- Instalar un paquete `.inf` local con una sola confirmación, sin consola.
- Ejecutarse desde un `.exe` único, sin instalación, sin admin para escanear y sin dejar datos fuera de su carpeta.

## Non-Goals

- No se mantiene una base de datos propia de millones de drivers ni se replica la de un competidor.
- Nada de descarga masiva ni instalación desatendida: cada paquete se descarga por una acción del usuario y toda escritura en el sistema pasa por su confirmación y UAC.
- Sin telemetría, sin cuentas, sin servidor propio y sin actualizaciones forzadas.
- No se replica código ni recursos de IObit Driver Booster; solo el concepto de flujo (escanear → listar → actualizar).

## Success Conditions

- En un equipo limpio, el escaneo completo termina sin error y sin ventanas de consola visibles.
- Cada actualización que ofrece Windows Update aparece como fila con su enlace al Catálogo de Microsoft Update.
- Un `.inf` instalado con la app aparece después en `pnputil /enum-drivers` y en el Administrador de dispositivos.
- Un paquete descargado desde el Catálogo se extrae sin errores y produce al menos un `.inf` válido.
- El `.exe` portable corre en un Windows 10/11 x64 sin Node, sin .NET y sin permisos de administrador para escanear.

## Capabilities

- **Escaneo de controladores**: enumera dispositivo, clase, fabricante, versión, fecha, estado PnP, hardware IDs e INF.
- **Escaneo de actualizaciones**: consulta Windows Update (`Type='Driver'`) y empareja cada actualización con su dispositivo por hardware ID.
- **Catálogo local ampliable**: JSON editable con últimas versiones conocidas por fabricante/clase; compara versiones numéricamente y distingue «al día» de «sin datos».
- **Veredicto por controlador** con la fuente: Windows Update, catálogo local o antigüedad.
- **Enlaces oficiales**: ficha del fabricante del componente según `VEN_`/`VID_` y su clase, ficha del OEM del equipo (con modelo y número de serie copiables), y búsqueda en el Catálogo de Microsoft Update por hardware ID.
- **Descarga integrada**: lista los paquetes que Microsoft publica para ese hardware ID y descarga el CAB oficial con progreso, una acción explícita por paquete, para extraerlo e instalarlo después.
- **Inventario del equipo**: procesador, gráficos, memoria módulo a módulo, almacenamiento, red, audio y batería.
- **Instalación manual asistida**: elegir carpeta con `.inf`, aviso de punto de restauración y `pnputil /add-driver … /install` elevado.
- **Informe exportable** en HTML y CSV/JSON a la carpeta de la aplicación.
- **Filtros y búsqueda** por estado, clase, fabricante y texto libre.

## Non-Functional Requirements

- **Portable**: datos, ajustes e informes junto al ejecutable (`PORTABLE_EXECUTABLE_DIR`), nunca en el perfil si el `.exe` es portable.
- **Privilegios**: escanear sin admin; elevar solo para instalar o crear punto de restauración, con consentimiento explícito.
- **Privacidad**: cero red salvo la búsqueda de Windows Update que el propio sistema hace; ninguna petición a servidores propios.
- **Robustez**: PowerShell con `-NoProfile -ExecutionPolicy Bypass`, salida JSON, timeouts y errores legibles en español; la UI nunca se queda colgada.
- **Accesibilidad**: contraste AA, navegación por teclado, estados no comunicados solo por color.

## Technology

| Aspecto | Elección | Razón |
| --- | --- | --- |
| Shell de escritorio | Electron 45 (Node 22) | Única cadena de herramientas disponible; permite un `.exe` único portable y UI web |
| Interfaz | HTML/CSS/JS sin bundler | Arranque rápido, cero dependencias de build en el renderer |
| Datos del sistema | PowerShell 5.1 (`Win32_PnPSignedDriver`, `Win32_PnPEntity`) | Presente en todo Windows, sin dependencias nativas |
| Actualizaciones | COM `Microsoft.Update.Session` | Fuente oficial, sin scraping ni claves |
| Instalación | `pnputil /add-driver /install` elevado | Herramienta oficial de Windows |
| Empaquetado | electron-builder `portable` | Un solo `.exe` autocontenido, sin instalador |
