# Prompt para Claude Code (en el otro proyecto)

**Antes de pegarlo:** copia esta carpeta completa (`docs/compartir-recibo/`) dentro del otro proyecto, por ejemplo en `docs/compartir-recibo/`. Claude necesita poder leerla.

---

Quiero que repliques en este proyecto la función de **compartir el recibo de una venta por correo y por WhatsApp**, tal como ya funciona en otro proyecto mío (Del Horno al Paladar). La documentación y el código de referencia están en `docs/compartir-recibo/`.

**Cómo trabajar**

1. Lee primero `docs/compartir-recibo/README.md`, `01-como-funciona.md` y `02-adaptar-al-otro-proyecto.md`; luego mira `codigo/`. `03-desplegar-y-probar.md` es para el final.
2. Explora ESTE proyecto antes de escribir nada: pila (React/Vite/Tailwind/Firebase o lo que sea), cómo se representa una venta y su recibo, dónde se muestra hoy el ticket, cómo se guardan los usuarios y sus roles, si ya hay Cloud Functions, reglas de Firestore, Hosting, PWA, sistema de avisos/toasts y modales.
3. El código de `codigo/` es **referencia**, no un paquete para pegar tal cual: `reciboPdf.ts`, `ReciboPublico.tsx` y `enviarReciboCorreo.js` son copias casi literales; `recibosCompartidos.ts` y `EnvioRecibo.tsx` son reescrituras que ya pasan `tsc --strict`. Adáptalos al estilo, rutas, capa de datos y diseño de este proyecto. Si este proyecto no usa Firebase o React, conserva la **arquitectura** y cambia la infraestructura (sección 2.4).
4. Mantén el diseño de seguridad: la función del correo exige ID token de personal autorizado; `recibos_compartidos` con id aleatorio de 128 bits, `get` público, `list` prohibido, `create` solo personal; el PDF se genera en el navegador y no se guarda; todo texto que va a HTML pasa por escape; `window.open` de WhatsApp dentro del clic y antes de cualquier `await`; respaldo en texto si falla el enlace.

**Antes de implementar, pregúntame** (una sola ronda, solo lo que no puedas deducir del código):
- Cuenta de Gmail que enviará los correos y nombre del remitente.
- Qué roles pueden enviar recibos y dónde están guardados.
- País / prefijo de celular, moneda y zona horaria.
- URL pública donde debe vivir `/recibo/<id>` (dominio de Hosting).
- Qué campos de la venta de este proyecto deben salir en el recibo (propina, IVA, etc.).

**Al terminar**
- Corre el chequeo de tipos/lint/build del proyecto y prueba la función con emuladores o con el transporte de correo simulado (nada de correos reales sin avisarme).
- Despliega en este orden y **solo cuando yo lo confirme**: reglas de Firestore → función → hosting. El secreto `GMAIL_APP_PASSWORD` lo configuro yo con `firebase functions:secrets:set`; no me lo pidas por chat ni lo escribas en ningún archivo.
- Dime qué probaste de verdad y qué no (envío real por Gmail, enlace en un celular, etc.), con la lista de `03-desplegar-y-probar.md` como guía.
- No hagas commit salvo que te lo pida.
