# 2. Adaptarlo al otro proyecto

## 2.1 Dónde va cada pieza

| Pieza | Archivo de referencia (`codigo/`) | Destino típico en el otro proyecto |
|---|---|---|
| Tipos + `fmtCOP` | `tiposRecibo.ts` | `src/utils/` (o fusionar con los tipos de recibo/ticket que ya existan) |
| PDF | `reciboPdf.ts` | `src/utils/reciboPdf.ts` |
| Llamadas a Firebase | `recibosCompartidos.ts` | `src/utils/` (o dentro de la capa de datos del proyecto, si tiene una) |
| Panel de envío | `EnvioRecibo.tsx` | junto al modal/pantalla donde se muestra el recibo de una venta |
| Página pública | `ReciboPublico.tsx` | `src/pages/Recibo/ReciboPublico.tsx` + ruta `/recibo/:id` **fuera** del layout con sesión |
| Cloud Function | `enviarReciboCorreo.js` | `functions/` (exportarla desde `functions/index.js`) |
| Regla de Firestore | `firestore.rules.fragmento` | `firestore.rules` |
| Cabeceras, PWA, TTL | `firebase.json.fragmento` | `firebase.json`, `vite.config.ts`, `firestore.indexes.json` |

Ruta en el router (react-router): **fuera** del layout autenticado y de cualquier guardia de sesión:

```tsx
<Route path="/recibo/:id" element={<ReciboPublico />} />   // carga perezosa, igual que el resto de páginas
```

Cómo se monta el panel en una pantalla (el original lo hace dentro de `openModalTicket`):

```tsx
const [canal, setCanal] = useState<'correo' | 'whatsapp' | null>(null);

{canal
  ? <EnvioRecibo key={canal} canal={canal} datos={datosTicket} negocio={negocio}
      aviso={(texto, tipo) => toast[tipo](texto)}          // tu sistema de avisos
      alVolver={() => setCanal(null)}
      buscarContacto={async (c, nombre) => { /* opcional: buscar al cliente por nombre */ return null; }} />
  : <>
      <button onClick={() => setCanal('correo')}>Correo</button>
      <button onClick={() => setCanal('whatsapp')}>WhatsApp</button>
    </>}
```

## 2.2 Lista de cosas que hay que decidir o cambiar

**Obligatorias**

1. **Proyecto de Firebase y plan.** Cloud Functions y los secretos exigen el plan **Blaze**. Confirmar el `projectId` y que `initializeApp` del cliente ya está hecho.
2. **Cuenta de Gmail del negocio** (`GMAIL_USER`) y su **contraseña de aplicación** (requiere verificación en dos pasos en esa cuenta de Google). Va en el secreto `GMAIL_APP_PASSWORD`, nunca en el código ni en `.env` del cliente.
3. **Roles.** La función exige `rol ∈ ROLES_PERMITIDOS` leyendo `usuarios/{uid}.rol`, y la regla usa `isAdmin()` / `isCaja()`. Si el otro proyecto guarda los roles distinto (otro nombre de colección/campo, *custom claims*, otros roles), cambiar **las dos cosas** a la vez: `_exigirPersonal` en la función y `create` en la regla. Con *custom claims* se puede leer `decodificado.rol` y ahorrar la lectura de Firestore.
4. **Región.** El cliente construye `https://us-central1-<proyecto>.cloudfunctions.net/enviarReciboCorreo`. Si la función se despliega en otra región, ponerla en `onRequest({ region: '…' })` **y** en `REGION` de `recibosCompartidos.ts`.
5. **URL pública del recibo.** `urlBaseRecibos()` devuelve `https://<projectId>.web.app`. Si el proyecto tiene varios sitios de Hosting o dominio propio, apuntar al sitio que sirva `/recibo/**` (en el original, el enlace va al sitio *admin* aunque la tienda esté en otro). Si es un dominio propio, añadirlo también a los dominios autorizados de Firebase Auth solo si en él se inicia sesión; para esta función no hace falta (la página pública no usa Auth).
6. **Reglas desplegadas antes que la app** (`firebase deploy --only firestore:rules`), o `setDoc` será rechazado y WhatsApp caerá al respaldo en texto.

**Según el país / idioma**

7. **Prefijo del celular** en `numeroWhatsapp()` (`57` / regla "10 dígitos que empiezan por 3" es de Colombia).
8. **Moneda y locale** en `fmt` / `fmtCOP` (`tiposRecibo.ts`), en `_cop` de la función, y los `toLocaleString('es-CO')` de `reciboPdf.ts`, `ReciboPublico.tsx` y `EnvioRecibo.tsx`. La zona horaria del correo es `ZONA_HORARIA` en la función.
9. **Textos** (títulos, avisos, mensaje de WhatsApp, asunto del correo `Recibo de compra …`, "PANADERÍA" como nombre por defecto en `reciboPdf.ts` / `ReciboPublico.tsx`).

**Según el negocio**

10. **Forma de `datos` y `negocio`.** Si la venta del otro proyecto tiene otros campos (propina, IVA desglosado, mesa, etc.), añadirlos en `DatosTicket`, en `reciboPdf.ts`, en `ReciboPublico.tsx`, en `ReciboCorreo` y en `_armarRecibo` (función). Los tres lugares que *dibujan* el recibo (PDF, página pública, correo) están duplicados a propósito: se mantienen a mano en paralelo.
11. **Etiquetas de método de pago** (`ETIQUETA_PAGO`, en el PDF y en la página).
12. **De dónde sale el "cliente".** El original usa `ventaData.cliente_nombre` y busca en la colección `clientes` por nombre (campos `correo`, `celular`) para precargar. Pasar `buscarContacto` si el otro proyecto tiene clientes; si no, omitirlo.
13. **Aspecto.** El PDF y la página pública usan colores del original (`#F5F1EA` fondo, `#B45309` botón). Cambiarlos a la marca del otro negocio. El panel de envío usa clases Tailwind simples en vez de las clases `btn` del sistema original.

**Opcionales (recomendadas)**

14. **TTL** para `recibos_compartidos` (ver `firebase.json.fragmento`, sección 5). Implica guardar `expiraEn` y añadirlo a `hasOnly([...])` de la regla.
15. **Límite por usuario/día** de correos enviados, si hay más de unas pocas personas con rol de caja.
16. **Dependencias**: web → `jspdf` (^4), `firebase` (^12), `lucide-react`, `react-router-dom`; funciones → `cors`, `nodemailer`, `firebase-admin` (≥ 14, **API modular**: `firebase-admin/app|auth|firestore`; `admin.firestore()` ya no existe), `firebase-functions` (v2, `onRequest`), Node 22.

## 2.3 Qué NO copiar del original

- La capa `src/utils/api.ts` (escucha compartida, escrituras sin esperar, transacciones, modo local, `sinRed()`): es del sistema de panadería, no de esta función. `recibosCompartidos.ts` ya no la necesita.
- `utils/ticket.ts` → `buildTicketHTML` / `imprimirVentanaRecibo`: es la **impresión** en papel térmico, otra función aparte. Solo se tomaron sus *tipos*.
- El almacén de modales (`useUiStore.openModal`), el sistema de avisos (`addToast`), los estilos `btn`/`estilos-admin.css`: infraestructura del sistema original.
- Todo lo de Electron/Capacitor/PWA, salvo la exclusión de jsPDF del precache si el otro proyecto también es PWA.

## 2.4 Si el otro proyecto NO usa Firebase

Se conserva el diseño, se cambia la infraestructura:
- **Correo**: un endpoint de servidor que (a) exige sesión del personal, (b) recibe el recibo estructurado + PDF en base64, (c) arma el cuerpo HTML escapando todo y (d) envía por SMTP o un proveedor (Resend, SES…). El remitente debe ser una dirección autenticada del dominio.
- **WhatsApp**: una tabla/colección de "recibos compartidos" con id aleatorio de ≥ 128 bits, **lectura pública solo por id** (sin listado) y escritura solo del personal, más una página pública que la lea y genere el PDF en el navegador. El truco de `window.open` antes del `await` y el respaldo en texto se mantienen.
