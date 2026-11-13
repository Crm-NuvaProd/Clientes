# NuvaMail en la nube

NuvaMail es una plataforma de correo masivo para NuvaProd. Incluye un editor visual de piezas, importación de piezas diseñadas por Claude, estadísticas al estilo Brevo con un veredicto de éxito por campaña, y entregabilidad cuidada de punta a punta.

```
Angular 22 (web)  ──►  NestJS 12 (API /api/v1, sesión, multiempresa)  ──►  PostgreSQL 16 (Row Level Security)
                              │                     ▲
                              ├──► Amazon SES ──────┘ eventos vía SNS (entregas, rebotes, quejas, aperturas, clics)
                              └──► S3 + CloudFront (imágenes de las piezas)
```

## Qué incluye (equivalente a Brevo)

| Brevo | NuvaMail |
|---|---|
| Editor de arrastrar y soltar | **Diseños de correo**. Bloques: encabezado, texto enriquecido, imagen, botón, imagen + texto, divisor, espacio, redes y HTML. Variables `{{nombre}}` y `{{empresa}}`, vista previa en escritorio y móvil, deshacer, biblioteca de imágenes. El HTML generado es responsive (MJML) |
| Importar plantilla HTML | **Importar pieza de Claude**. Acepta JSON `nuvamail/1` (queda editable bloque por bloque) o HTML completo. Las imágenes incrustadas se suben solas a S3 |
| Listas, segmentos, importación | **Contactos**. CSV de Excel (`;` o `,`) con validación de sintaxis, MX, errores de digitación y dominios desechables. Segmentos: comprometidos, inactivos y nunca contactados. Supresión de datos (Ley 1581) |
| Prueba A/B | Asunto A/B sobre el 10–30 % de la lista. El ganador se elige por aperturas reales o por clics y se envía al resto |
| Programación | Envío inmediato o programado |
| Informe de campaña | Pestañas **Resumen**, **Entregabilidad**, **Aperturas**, **Clics** y **A/B**, más exportación CSV por destinatario |
| Aperturas de Apple MPP | Se separan: la "apertura real" no las cuenta |
| Rebotes duros y temporales | Motivo del servidor; supresión automática (rebote duro, o 3 temporales seguidos) |
| Desglose por dominio | Gmail, Hotmail, Outlook, Yahoo, iCloud y "corporativos" (entrega, rebote y apertura) |
| Panel de estadísticas | **Panel** con salud de reputación a 30 días, tendencia por campaña y contactos por estado |

### Indicadores y veredicto ("¿fue exitosa la campaña?")

Cada reporte calcula un puntaje de 0 a 100 y un nivel: **Exitosa**, **Aceptable**, **Por mejorar** o **Problema de entregabilidad**. Los umbrales son referencias B2B y están en `apps/api/src/estadisticas/veredicto.ts`.

| Indicador | Peso | Bien | Regular |
|---|---|---|---|
| Tasa de entrega | 20 | ≥ 98 % | ≥ 95 % |
| Rebote duro | 15 | ≤ 0,5 % | ≤ 2 % |
| Quejas por spam | 20 | ≤ 0,05 % | ≤ 0,1 % |
| Apertura real (sin Apple MPP) | 15 | ≥ 25 % | ≥ 15 % |
| CTR (clics / entregados) | 15 | ≥ 2,5 % | ≥ 1 % |
| CTOR (clics / aperturas) | 10 | ≥ 10 % | ≥ 6 % |
| Bajas | 5 | ≤ 0,3 % | ≤ 0,8 % |

Si las quejas, el rebote o la entrega quedan en "mal", el nivel pasa a *Problema de entregabilidad* sin importar el puntaje. El reporte también compara con el promedio de las últimas 5 campañas y da recomendaciones concretas.

## Estrategias para tener el menor número de rechazos

1. **SPF, DKIM y DMARC alineados** en un subdominio dedicado (`mail.nuvaprod.com`). La pantalla *Entregabilidad* verifica el DNS.
2. **Calentamiento**: tope diario creciente (500 → 10.000 en 7 días, configurable).
3. **Envío priorizado**: salen primero los contactos que más interactúan.
4. **Tope por dominio** (correos por minuto a un mismo servidor), para que los servidores corporativos de los clientes no lo frenen.
5. **Validación al importar** (sintaxis, MX, `gmial.com`, desechables, `noreply@`) y **no reactivación** de bajas, rebotes o quejas.
6. **Supresión automática** por rebote duro, 3 rebotes temporales seguidos, queja o baja.
7. **Política de inactividad** por campaña: excluye a quien recibió 3 o más envíos sin interactuar en 90, 180 o 365 días.
8. **Baja en un clic RFC 8058** (`List-Unsubscribe-Post`) y enlace visible en el pie legal, que se agrega solo.
9. **Cortacircuitos**: pausa la campaña si el rebote duro pasa del 4 % o las quejas del 0,1 % (con un mínimo de casos).
10. **Revisión antispam** antes de enviar. Bloquea acortadores, `RE:` falsos, scripts, imágenes en base64, falta de baja y remitentes Gmail/Hotmail. Avisa de mayúsculas, palabras gatillo, proporción imagen/texto, tamaño mayor a 102 KB y falta de `alt`.
11. **Cabeceras correctas**: `Feedback-ID` (Gmail Postmaster), `Precedence: bulk`, versión texto plano y Message-ID del dominio propio.
12. **Prueba A/B** con muestra pequeña antes de enviar a toda la lista.

## Seguridad

- **Multiempresa con Row Level Security**: la API se conecta con un rol sin privilegios y cada transacción fija `app.empresa_id`. Probado: un usuario de la empresa B recibe 404 en campañas, reportes y plantillas de la empresa A.
- Sesión en cookie `HttpOnly; Secure; SameSite=Strict` (nada en `localStorage`), cabecera anti-CSRF `x-nuvamail`, contraseñas con Argon2id, límite de intentos de inicio de sesión.
- Roles: `admin` (todo), `editor` (contactos, diseños y campañas) y `analista` (solo lectura).
- Validación de todos los DTO (`whitelist` + `forbidNonWhitelisted`), errores RFC 7807 sin trazas, Helmet con CSP.
- Piezas importadas saneadas (sin `<script>`, eventos `on*`, `javascript:` ni iframes) y vistas previas en iframes `sandbox`.
- La personalización no usa motor de plantillas (no hay inyección de código) y escapa el HTML.
- Webhook de SNS con verificación de firma (rechaza mensajes alterados o de otros certificados) y restricción por tema.
- Imágenes validadas por firma de archivo (JPG, PNG, GIF, WEBP; máximo 5 MB). El CSV exportado se protege contra inyección de fórmulas.

## Desarrollo local

```bash
# 1. PostgreSQL 16 con dos roles: dueño (migraciones) y app (sin privilegios)
createuser nuvamail_admin -P; createuser nuvamail -P; createdb nuvamail -O nuvamail_admin
psql -d nuvamail -c "GRANT USAGE ON SCHEMA public TO nuvamail;"

# 2. Dependencias, migraciones y primera empresa
npm run instalar
export DATABASE_ADMIN_URL=postgres://nuvamail_admin:CLAVE@localhost/nuvamail
npm run migrar
node apps/api/scripts/sembrar.mjs "NuvaProd S.A.S." admin@nuvaprod.com "Clave-Larga-2026" mail.nuvaprod.com

# 3. API (modo simulación: no envía, genera eventos realistas) y web
DATABASE_URL=postgres://nuvamail:CLAVE@localhost/nuvamail npm run api   # http://localhost:3000
npm run web                                                                # http://localhost:4200
npm run probar                                                             # pruebas
```

O con Docker: `docker compose up -d --build`, luego `docker compose run --rm migrar`.

## Puesta en la nube

**Render (recomendado para empezar):** suba este repositorio a GitHub y en Render elija *New → Blueprint*. El archivo `render.yaml` crea la base PostgreSQL y la app; en el formulario escriba `SEMBRAR_EMAIL` y `SEMBRAR_CLAVE` (el usuario administrador) y, cuando SES esté listo, las claves de AWS. Las imágenes se guardan en la base de datos si no configura S3.

**AWS:**

La guía paso a paso para AWS (App Runner o ECS Fargate, RDS PostgreSQL, SES, SNS, S3 + CloudFront y Secrets Manager) está en [DESPLIEGUE.md](DESPLIEGUE.md).

## Estructura

```
apps/api/            NestJS (ESM)
  migraciones/       SQL versionado (tablas, índices, RLS, funciones)
  scripts/           migrar.mjs, sembrar.mjs
  src/auth           inicio de sesión
  src/contactos      importación, listas, segmentos, supresión
  src/plantillas     render MJML, saneamiento, importación de piezas de Claude
  src/activos        imágenes (S3 o disco)
  src/campanas       CRUD, revisión antispam, pruebas, envío, A/B
  src/envio          trabajador, SES, eventos, token de baja, simulador
  src/estadisticas   KPI, reporte, veredicto, panel, CSV
  src/empresa        remitente, calentamiento, chequeo DNS
  src/publico        página de baja, baja en un clic, webhook SNS
apps/web/            Angular 22 (standalone, signals, OnPush, carga diferida, ECharts)
libs/contratos/      tipos compartidos API ↔ web
docs/                formato de piezas para Claude
```
