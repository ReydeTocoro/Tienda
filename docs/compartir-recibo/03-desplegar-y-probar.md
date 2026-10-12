# 3. Desplegar y probar

## 3.1 Orden de despliegue

1. **Funciones: dependencias y secreto**
   ```bash
   cd functions && npm install nodemailer cors && cd ..
   firebase functions:secrets:set GMAIL_APP_PASSWORD     # pega la contraseña de aplicación de Gmail
   ```
   Las variables no secretas van en `functions/.env`: `GMAIL_USER=…` y `NOMBRE_NEGOCIO=…`.
2. **Reglas primero**: `firebase deploy --only firestore:rules --project <id>`. La app escribe `recibos_compartidos`; sin la regla, esa escritura se rechaza.
3. **Función**: `firebase deploy --only functions:enviarReciboCorreo --project <id>`.
4. **Hosting** (después de `npm run build`): `firebase deploy --only hosting --project <id>`. Usar el **CLI**; el despliegue de Hosting a través del wrapper MCP de Firebase falló con un error interno en el proyecto original.

## 3.2 Probar sin tocar producción

Un despliegue solo demuestra que el código **carga**, no que **funcione**. Antes de desplegar, ejecutar la función contra los emuladores:

```bash
firebase emulators:exec --only firestore,auth,functions "node tu-prueba.js"
```

- Los emuladores de Firestore necesitan **Java** (en Windows sirve el JBR de Android Studio: `C:\Program Files\Android\Android Studio\jbr`).
- Para probar el cliente contra los emuladores, `connectFirestoreEmulator` / `connectAuthEmulator` con proyecto `demo-…`.
- Con `nodemailer` conviene **sustituir el transporte** en la prueba para no mandar correos reales (así se probó la copia de `codigo/enviarReciboCorreo.js`: 405 / 401 / 401 / 403 / 400 / 200, HTML escapado, adjunto presente o ausente).

## 3.3 Lista de comprobación manual

**Correo**
- [ ] Con usuario `caja` o `admin`: llega el correo con el recibo en el cuerpo **y** el PDF adjunto `Recibo_<n>.pdf`.
- [ ] El remitente que ve el cliente es la cuenta de Gmail configurada (no otra).
- [ ] Con un usuario de otro rol (o sin sesión): error legible ("Tu usuario no puede enviar recibos." / "Inicia sesión…").
- [ ] Correo mal escrito: el panel lo rechaza antes de llamar a la función.
- [ ] Un producto con `<` o `&` en el nombre no rompe el correo ni inyecta HTML.
- [ ] Si falla la generación del PDF, el correo sale igual sin adjunto.

**WhatsApp**
- [ ] 10 dígitos que empiezan por 3 → abre `wa.me/57…` con el mensaje y el enlace.
- [ ] El enlace abre `/recibo/<id>` **en una ventana de incógnito / otro dispositivo sin sesión** y muestra el recibo.
- [ ] "Descargar PDF" funciona en el celular (iOS Safari y Android Chrome).
- [ ] Un id inventado muestra "No encontramos este recibo".
- [ ] Sin conexión, o con la regla sin desplegar: aviso naranja y se manda el **texto** del recibo.
- [ ] No hay aviso de "ventanas emergentes" bloqueadas en uso normal (la pestaña se abre dentro del clic).
- [ ] En la consola de Firestore, `list` sobre `recibos_compartidos` desde un cliente sin permisos falla; `get` por id funciona.
- [ ] `/recibo/<id>` nunca sale en modo oscuro y tiene `noindex`.

## 3.4 Problemas conocidos y cómo se resolvieron

| Síntoma | Causa | Solución |
|---|---|---|
| El navegador recibe **403** al llamar la función | Cloud Run sin permiso público de invocación (pasó tras un primer despliegue a medias) | `invoker: "public"` en las opciones de `onRequest`; si un redeploy normal no lo arregla, **borrar y volver a crear** la función. La seguridad real la da el chequeo del ID token dentro del código. |
| La función falla al cargar o al usar `admin.firestore()` / `admin.auth()` | `firebase-admin` 14 **quitó** esa API antigua | Importar `getFirestore` / `getAuth` de `firebase-admin/firestore` / `firebase-admin/auth`. |
| El correo sale desde otra dirección o cae en spam | `from` distinto de la cuenta autenticada | `from` = `CUENTA_CORREO` (ya está así). |
| "El servidor no respondió a tiempo" al crear el enlace | Red lenta o regla sin desplegar | Reglas primero; el respaldo en texto cubre el caso. |
| El navegador bloquea la pestaña de WhatsApp | `window.open` después de un `await` | Abrirla al inicio del clic y redirigirla después (ya está así; no reordenar). |
| Caracteres raros en el PDF | Fuentes PDF estándar solo Latin-1 | `limpio()` ya sustituye guiones largos, viñetas, comillas tipográficas y quita emojis. |
| La app precachea megas de jsPDF | `vite-plugin-pwa` incluye todos los chunks | `globIgnores` de `jspdf*`, `html2canvas*`, `purify*` (ver `firebase.json.fragmento`). |
| Gmail rechaza el inicio de sesión | Se usó la contraseña normal | Hace falta una **contraseña de aplicación** (cuenta con verificación en dos pasos). |
| En la APK de Android el botón de WhatsApp no abre nada | Android WebView no soporta `window.open('')` | Ruta nativa (Capacitor Share/Browser) si el otro proyecto también se empaqueta como APK. |
