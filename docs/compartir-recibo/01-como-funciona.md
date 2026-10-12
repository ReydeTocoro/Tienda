# 1. Cómo funciona

## 1.1 Punto de partida

Después de cobrar, el sistema abre el modal **Ticket de venta** (`openModalTicket` en `src/pages/Caja/CajaTicket.tsx`; también se abre al reimprimir una venta antigua con `abrirModalTicketVenta`). Tiene cuatro botones: Cerrar, **Correo**, **WhatsApp**, Imprimir. Correo y WhatsApp abren, *dentro del mismo modal*, un panel de una sola fila: campo de destino + "Enviar" + flecha de volver. (El almacén de modales guarda **una** ventana, por eso no se abre otra encima.)

Los tres canales (imprimir, correo, WhatsApp) salen de **los mismos datos**, `datosTicket()`:

```ts
{ id, numero, fecha /*ISO*/, cajero, cliente /* 'Cliente general' si no hay */, nota, metodo,
  items: [{ nombre, qty, precio }], total, subtotal, descuento, efectivo_recibido, cambio,
  tipo_documento /* 'ticket' | 'factura' */ }
```

y de `negocio` (nombre, NIT, dirección, teléfono y los textos `ticket_header/sub/dir/tel/footer/footer2` que el administrador edita en Configuración → Ticket).

**Precarga del destino.** Si el nombre del cliente del cobro coincide (sin mayúsculas) con un documento de `clientes`, se precarga su `correo` o `celular` y se muestra "· de <nombre>". Siempre se puede escribir otro. "Cliente general" no precarga nada.

## 1.2 Correo

1. Valida el correo con `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`.
2. Genera el PDF **en el navegador** (`generarReciboPdf` → `Blob` → `blobABase64`). Si falla (navegador raro, poca memoria), se sigue **sin PDF**: el cuerpo del correo ya lleva el recibo completo.
3. `POST https://us-central1-<proyecto>.cloudfunctions.net/enviarReciboCorreo` con
   `Authorization: Bearer <ID token del usuario>` y `{ to, recibo, pdfBase64? }`.
   `recibo` es un objeto **estructurado** (no HTML): `{ negocio:{nombre,nit,direccion,telefono,mensaje}, numero, fecha, cliente, metodo, items, subtotal, descuento, total, efectivo_recibido, cambio }`.
4. La función (`onRequest`, `invoker: "public"`, con el secreto `GMAIL_APP_PASSWORD`):
   - CORS con el paquete `cors` (`origin: true`); solo acepta `POST` (405 si no).
   - **Autenticación en el código**: exige el Bearer, lo verifica con `getAuth().verifyIdToken`, lee `usuarios/{uid}` y exige `rol ∈ {admin, caja}` (401 / 403 con mensaje legible).
   - Valida `to` y que venga `recibo` (400).
   - Arma el cuerpo **HTML** (tablas en línea, ancho 480 px) y una versión de **texto plano**; todo lo que llega del cliente HTTP pasa por `_esc()`; recorta a 200 líneas.
   - Envía con `nodemailer` (`service: "gmail"`, usuario = `CUENTA_CORREO`, contraseña = secreto). Asunto: `Recibo de compra <número>`.
   - Adjunta el PDF solo si es válido: string de más de 100 y menos de 1,4 M caracteres base64 (un recibo real pesa ~5 KB). Nombre: `Recibo_<número saneado>.pdf`.
   - Responde `{ success: true }` o `{ error }`; la app muestra ese texto tal cual en un aviso.
5. La app avisa "Recibo enviado a …" y vuelve a los botones.

## 1.3 WhatsApp

`wa.me` solo transporta **texto**: no se puede adjuntar un archivo. Por eso el PDF no viaja; viaja un enlace.

1. `numeroWhatsapp()` normaliza: quita todo lo que no sea dígito y ceros iniciales; 10 dígitos que empiezan por `3` → antepone `57` (celular colombiano); 11 a 15 dígitos se respetan tal cual (otro país); cualquier otra cosa → error "Escribe el celular completo (10 dígitos…)". Los fijos de 7 dígitos no sirven.
2. **`window.open('', '_blank')` se ejecuta primero, dentro del clic**, antes de cualquier `await`. Si se abriera después de esperar, el navegador la bloquearía como ventana emergente (si igual está bloqueada, se avisa "Habilita las ventanas emergentes…").
3. `crearReciboCompartido`:
   - Sin conexión → error (la escritura quedaría en cola y el cliente abriría un enlace vacío).
   - `id` = 16 bytes de `crypto.getRandomValues` en hexadecimal (**128 bits**, 32 caracteres).
   - `setDoc(recibos_compartidos/<id>, { datos, negocio, creado_en: serverTimestamp() })`, tras pasar el objeto por `JSON.parse(JSON.stringify(…))` (Firestore rechaza `undefined`).
   - **Espera la confirmación del servidor** (máx. 8 s). A diferencia de casi todas las escrituras de la app, que no esperan: si el enlace sale antes de que el documento exista, el cliente vería "no encontrado".
   - Devuelve `https://<proyecto>.web.app/recibo/<id>`.
4. La pestaña ya abierta se redirige a `https://wa.me/<número>?text=<mensaje codificado>`. El mensaje:
   ```
   *<Negocio>*
   Recibo <n> · Total: $<total>

   Ver y descargar tu recibo (PDF):
   <enlace>

   <mensaje de despedida>
   ```
5. **Respaldo**: si crear el enlace falla (reglas, red, tiempo), se muestra un aviso y se manda el recibo **en texto** (`textoRecibo()`: líneas `• 2 x Pan — $3.000`, descuento, total). Siempre funciona.
6. El cajero tiene que pulsar "enviar" en WhatsApp: es un chat con el texto prellenado, no un envío automático (no usa la API de WhatsApp Business). En celular abre la app; en PC, WhatsApp Web o de escritorio.

## 1.4 La página pública `/recibo/:id`

`src/pages/Recibo/ReciboPublico.tsx`, ruta fuera del layout del sistema y **sin login**:

- Lee `recibos_compartidos/<id>` con `getDoc`. Si no existe (o la lectura falla) muestra "No encontramos este recibo".
- Dibuja el recibo con **JSX**, no con HTML armado a mano: el documento lo escribió el personal pero lo lee quien tenga el enlace, así que React escapa todo en vez de fiarse del contenido.
- Botón **Descargar PDF**: `generarReciboPdf(datos, negocio)` en el celular del cliente → `Blob` → enlace `<a download>` → `Recibo_<n>.pdf`. jsPDF se descarga en ese momento, no antes.
- Es privada: `<meta name="robots" content="noindex">` desde el componente, y en Hosting `X-Robots-Tag: noindex` + `Referrer-Policy: no-referrer` para `/recibo/**`.
- **Nunca modo oscuro** (`index.html` y `store/modoStore.ts` lo excluyen en `/recibo/…`): es una vista de papel.

## 1.5 El PDF (`reciboPdf.ts`)

Mismo recibo que el ticket térmico de **80 mm**, como texto real (no captura): ~5 KB, nítido, seleccionable. Courier 8 pt (42 columnas en 72 mm). Se dibuja **en dos pasadas**: la primera solo mide el alto y la segunda crea la página del tamaño justo (un rollo, sin hoja en blanco). Las fuentes estándar de PDF son Latin-1: tildes y ñ salen bien, pero guiones largos, viñetas y emojis no, así que `limpio()` los reemplaza por equivalentes o los quita. jsPDF se importa con `import('jspdf')` y se excluye del precache del service worker.

## 1.6 Modelo de datos y seguridad

**Colección `recibos_compartidos/{id}`** — un documento de ~500 bytes:

```
datos:     { …DatosTicket }       // lo que ve el cliente
negocio:   { …ConfigNegocio }     // encabezado y pie
creado_en: serverTimestamp()
```

Regla (`firestore.rules.fragmento`):

| Operación | Quién |
|---|---|
| `get` | cualquiera (es el enlace secreto) |
| `list` | **nadie** (no se puede enumerar la colección) |
| `create` | `admin` o `caja`, con solo las claves `datos/negocio/creado_en` y `datos.items.size() <= 200` |
| `update` | nadie |
| `delete` | `admin` |

Por qué esto es aceptable: el id tiene 128 bits de aleatoriedad, así que no es adivinable y no se puede listar; quien recibe el enlace es quien debe ver el recibo.

**La función del correo** es pública a nivel de red (`invoker: "public"`, imprescindible para que el navegador llegue; sin él Cloud Run responde 403) pero **cada llamada exige un ID token de un usuario del personal**. Sin esa comprobación, la URL serviría para mandar correo desde el Gmail del negocio a cualquiera.

**Otras decisiones**
- El recibo va en el **cuerpo** del correo *y* como PDF adjunto: se ve en cualquier celular sin abrir nada, y si el PDF falla el correo sale igual.
- El PDF lo arma **el navegador** (nada de generador de PDF en el servidor) y **no se almacena**: no hay Firebase Storage en el proyecto.
- El remitente (`from`) **debe ser la misma cuenta autenticada** en Gmail; si no, Gmail reescribe el encabezado en silencio o el correo cae en spam.
- `from`, cuenta, nombre y roles no están fijos en el código: cuenta y nombre salen de variables de entorno.

## 1.7 Límites conocidos (de leer el código, no de suposiciones)

- `recibos_compartidos` **no tiene TTL**: los enlaces viven para siempre y contienen el nombre del cliente y su compra. `firebase.json.fragmento` trae cómo añadirle caducidad.
- Cualquier usuario `admin`/`caja` puede mandar un correo a **cualquier dirección** desde el Gmail del negocio; no hay límite por usuario. Las cuentas Gmail personales tienen además un tope diario de envío (del orden de 500 al día).
- Android WebView (APK con Capacitor) **no soporta `window.open('')`**: en la APK el botón de WhatsApp necesita una ruta nativa (Share/Browser). Electron sí lo maneja.
- En modo local del sistema original (sin Firebase) ambas cosas lanzan `SIN_FUNCIONES::…`; no aplica al otro proyecto salvo que también tenga un modo local.
