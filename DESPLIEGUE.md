# Despliegue de NuvaMail en AWS

Arquitectura recomendada para unos 10.000 contactos, con margen para crecer. Cuesta aproximadamente **USD 45–70 al mes** más USD 0,10 por cada 1.000 correos.

| Pieza | Servicio | Tamaño inicial |
|---|---|---|
| App (API + web) | **AWS App Runner** desde la imagen Docker (o ECS Fargate) | 1 vCPU / 2 GB, 1–2 instancias |
| Base de datos | **RDS PostgreSQL 16** | db.t4g.micro, 20 GB gp3, copias automáticas 7 días |
| Envío | **Amazon SES** + Configuration Set `nuvamail` | Salida del sandbox: ~15.000/día |
| Eventos | **SNS** tema `nuvamail-eventos` → HTTPS `/ses/eventos` | — |
| Imágenes | **S3** (privado) + **CloudFront** `img.mail.nuvaprod.com` | — |
| Secretos | **Secrets Manager** | JWT_SECRET, UNSUB_SECRET y URL de la base |
| Dominio | Route 53 o el DNS actual | `mail.nuvaprod.com` (app y envío) |

Use la misma región en todo (`us-east-1` tiene la mayor cuota de SES).

## 1. Base de datos (RDS)

1. Cree RDS PostgreSQL 16 en subred privada, con cifrado en reposo y sin acceso público.
2. Desde una máquina con acceso (por ejemplo, CloudShell en la VPC):
   ```sql
   CREATE ROLE nuvamail_admin LOGIN PASSWORD '…';   -- dueño del esquema (migraciones)
   CREATE ROLE nuvamail LOGIN PASSWORD '…';         -- rol de la app, sujeto a RLS
   CREATE DATABASE nuvamail OWNER nuvamail_admin;
   \c nuvamail
   ALTER SCHEMA public OWNER TO nuvamail_admin;
   GRANT USAGE ON SCHEMA public TO nuvamail;
   ```
3. Migre y cree la empresa con la imagen ya publicada:
   ```bash
   docker run --rm -e DATABASE_ADMIN_URL=postgres://nuvamail_admin:…@rds…/nuvamail nuvamail node scripts/migrar.mjs
   docker run --rm -e DATABASE_ADMIN_URL=… nuvamail node scripts/sembrar.mjs "NuvaProd S.A.S." admin@nuvaprod.com "Clave-Larga" mail.nuvaprod.com
   ```

## 2. Imagen y App Runner

```bash
aws ecr create-repository --repository-name nuvamail
docker build -t nuvamail .
docker tag nuvamail:latest CUENTA.dkr.ecr.us-east-1.amazonaws.com/nuvamail:latest
aws ecr get-login-password | docker login --username AWS --password-stdin CUENTA.dkr.ecr.us-east-1.amazonaws.com
docker push CUENTA.dkr.ecr.us-east-1.amazonaws.com/nuvamail:latest
```

En App Runner configure:
- Origen: la imagen de ECR. Puerto 3000. Health check en `/`.
- **Conector VPC** hacia la subred de RDS.
- Variables (ver `.env.example`), con `DATABASE_URL`, `JWT_SECRET` y `UNSUB_SECRET` traídos desde Secrets Manager.
- Rol de instancia con permisos `ses:SendEmail`, `ses:SendRawEmail` y `s3:PutObject` sobre el bucket de imágenes.
- Dominio personalizado `mail.nuvaprod.com` (App Runner emite el certificado TLS).

El trabajador de envío corre dentro de la app y usa un candado de PostgreSQL, así que con 2 réplicas no se duplican correos.

## 3. Amazon SES

1. *Identities → Create identity → Domain* `mail.nuvaprod.com`, con **Easy DKIM RSA 2048**. Publique los 3 CNAME.
2. **Custom MAIL FROM** `bounce.mail.nuvaprod.com`:
   - MX `10 feedback-smtp.us-east-1.amazonses.com`
   - TXT `v=spf1 include:amazonses.com ~all`
3. DMARC en `_dmarc.mail.nuvaprod.com`: `v=DMARC1; p=none; rua=mailto:dmarc@nuvaprod.com`. Después de 2 a 4 semanas limpias, pase a `quarantine` y luego a `reject`.
4. **Configuration Set** `nuvamail`:
   - Event destination → SNS `nuvamail-eventos` con *Send, Delivery, Bounce, Complaint, Reject, Rendering failure, Delivery delay, Open, Click*.
   - *Tracking options* → dominio personalizado `click.mail.nuvaprod.com` (CNAME que indica SES) para que los enlaces rastreados sean de su dominio.
   - Active *Reputation metrics*.
5. **Salida del sandbox** (*Account dashboard → Request production access*). Explique que son clientes con autorización (Ley 1581), con baja en un clic, supresión automática de rebotes y quejas vía SNS, calentamiento y pausa automática por umbrales.
6. Opcional: en *Suppression list* active la lista de supresión a nivel de cuenta (bounces y complaints).

## 4. SNS → webhook

```bash
aws sns create-topic --name nuvamail-eventos
aws sns subscribe --topic-arn arn:aws:sns:us-east-1:CUENTA:nuvamail-eventos \
  --protocol https --notification-endpoint https://mail.nuvaprod.com/ses/eventos
```

La app verifica la firma y confirma la suscripción sola. Ponga el ARN en `SNS_TOPIC_ARN` para rechazar cualquier otro tema.

## 5. Imágenes (S3 + CloudFront)

- Bucket privado `nuvamail-imagenes` con *Block Public Access* activado.
- CloudFront con *Origin Access Control* hacia el bucket, dominio `img.mail.nuvaprod.com` y certificado de ACM (en `us-east-1`).
- Variables: `S3_BUCKET=nuvamail-imagenes`, `S3_PUBLIC_URL=https://img.mail.nuvaprod.com`.

## 6. Antes del primer envío real

1. En *Configuración*, defina el remitente (`mauricio@mail.nuvaprod.com`), el pie legal con NIT y dirección, la URL de la política de datos y la **fecha de inicio del calentamiento**.
2. En *Entregabilidad*, verifique que SPF, MX y DMARC estén en verde.
3. Envíe una campaña de prueba a Gmail, Outlook y su correo corporativo. En "Mostrar original" deben aparecer SPF, DKIM y DMARC = **PASS**.
4. Regístrese en **Google Postmaster Tools** con `mail.nuvaprod.com`.
5. Cambie `DRY_RUN=false`.

## 7. Operación

- **Copias**: las automáticas de RDS más un `pg_dump` semanal a S3 cifrado.
- **Alarmas en CloudWatch**: `Reputation.BounceRate > 2 %` y `Reputation.ComplaintRate > 0,1 %` (métricas de SES), errores 5xx de App Runner y CPU de RDS.
- **Actualizaciones**: `docker build` → `push` → App Runner despliega solo. Las migraciones nuevas se agregan como `migraciones/00X_*.sql` y se aplican con `scripts/migrar.mjs` antes de desplegar.
- **Seguridad**: corra `npm audit` en `apps/api` y `apps/web` en CI y bloquee el despliegue si hay vulnerabilidades altas.
