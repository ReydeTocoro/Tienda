# Compartir el recibo por correo y WhatsApp

Documentación de cómo funciona, en **Del Horno al Paladar**, el botón que manda el recibo de una venta al cliente por **correo** (con PDF adjunto) o por **WhatsApp** (con un enlace a una página que muestra el recibo y deja descargar el PDF). Está pensada para **replicarla en otro proyecto** y para dársela a Claude Code como contexto.

> Pila original: React 19 + TypeScript + Vite + Tailwind + Firebase (Auth, Firestore, Cloud Functions v2, Hosting). Si el otro proyecto usa otra pila, se replica la **arquitectura** (`01-como-funciona.md`), no el código.

## En una frase

El correo lo manda una Cloud Function con el Gmail del negocio (solo personal autenticado); WhatsApp no deja adjuntar archivos desde un enlace `wa.me`, así que se guarda el **texto** del recibo en Firestore bajo un código aleatorio y el mensaje lleva el enlace `/recibo/<código>`, donde el cliente ve el recibo y descarga un PDF que **se genera en su propio celular**. Nunca se guarda un archivo PDF en ningún servidor.

```
 CAJERO (app, con sesión)                                   CLIENTE
 ───────────────────────                                    ───────
 Ticket de venta ──► [Correo]
                       │ 1. genera PDF en el navegador (jsPDF)
                       │ 2. POST + Bearer <ID token> ──► Cloud Function enviarReciboCorreo
                       │                                   · verifica token y rol (admin/caja)
                       │                                   · arma HTML+texto, adjunta PDF
                       │                                   · nodemailer → Gmail SMTP ─────────► bandeja del cliente
                       │
                    [WhatsApp]
                       │ 1. window.open('') (dentro del clic, antes de esperar)
                       │ 2. setDoc recibos_compartidos/<128 bits aleatorios> {datos, negocio}
                       │ 3. pestaña → wa.me/57<cel>?text=…  https://<proyecto>.web.app/recibo/<id>
                       ▼                                                        │
                  WhatsApp (el cajero pulsa enviar)  ──────────────────────────►│
                                                                                ▼
                                                    /recibo/<id> (pública, sin login)
                                                    · getDoc (la regla permite get, no list)
                                                    · muestra el recibo (JSX)
                                                    · "Descargar PDF" → jsPDF en su celular
```

## Contenido de esta carpeta

| Archivo | Para qué sirve |
|---|---|
| [`01-como-funciona.md`](01-como-funciona.md) | Flujos paso a paso, modelo de datos, seguridad y **por qué** se diseñó así. |
| [`02-adaptar-al-otro-proyecto.md`](02-adaptar-al-otro-proyecto.md) | Mapa de archivos originales → copias → destino, y la lista de cosas que hay que cambiar. |
| [`03-desplegar-y-probar.md`](03-desplegar-y-probar.md) | Orden de despliegue, secreto de Gmail, pruebas y problemas conocidos. |
| [`PROMPT_PARA_CLAUDE.md`](PROMPT_PARA_CLAUDE.md) | Texto listo para pegarle a Claude Code en el otro proyecto. |
| [`codigo/`](codigo/) | Código de referencia (ver abajo). |

### `codigo/`

| Archivo | Origen en este repo | Qué es |
|---|---|---|
| `enviarReciboCorreo.js` | `functions/index.js` (l. 1-146) | **Copia** de la Cloud Function; solo se parametrizaron cuenta, roles y zona horaria, y `initializeApp()` quedó protegido con `getApps()` para poder usarla en un archivo aparte. |
| `reciboPdf.ts` | `src/utils/reciboPdf.ts` | **Copia**; solo cambia el origen de los imports. |
| `ReciboPublico.tsx` | `src/pages/Recibo/ReciboPublico.tsx` | **Copia**; solo cambian los imports. |
| `recibosCompartidos.ts` | `src/utils/api.ts` (l. ~1311-1397) | **Reescrito** directo contra el SDK de Firebase (el original pasa por la capa `api.ts` del sistema). |
| `EnvioRecibo.tsx` | `src/pages/Caja/CajaTicket.tsx` | **Extraído y reordenado**: misma lógica, pero toasts, lista de clientes y datos entran por props. |
| `tiposRecibo.ts` | `src/utils/ticket.ts` + `format.ts` | Tipos (`DatosTicket`, `ConfigNegocio`, `ReciboCorreo`) y `fmtCOP`. |
| `firestore.rules.fragmento` | `firestore.rules` | Regla de `recibos_compartidos`. |
| `firebase.json.fragmento` | `firebase.json`, `vite.config.ts` | Cabeceras de `/recibo/**`, exclusión del precache PWA, TTL opcional. |

Los textos de la interfaz, los comentarios y los mensajes de error están en español, como en el original.

## Estado de verificación (2026-10-12)

- **Comprobado**: los `.ts`/`.tsx` de `codigo/` pasan `tsc --strict` contra firebase 12, react 19, jspdf 4, react-router 7 y lucide-react (en una carpeta aparte, con las dependencias instaladas ahí). La Cloud Function se ejecutó con Auth/Firestore/nodemailer simulados: responde 405 (no POST), 401 (sin token / token inválido), 403 (rol sin permiso), 400 (correo inválido) y 200 con el PDF adjunto; escapa HTML en el cuerpo del correo; sin PDF válido envía el correo sin adjunto.
- **No comprobado en esta tarea**: un envío real por Gmail, las reglas contra un Firestore real/emulador, ni la reescritura `EnvioRecibo.tsx` / `recibosCompartidos.ts` dentro de un navegador. El **original** (`CajaTicket.tsx`, `api.ts`) sí está en producción en https://delhornoalpaladar-yei.web.app; si algo de las reescrituras se comporta distinto, manda el original.
