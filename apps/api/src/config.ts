function env(nombre: string, defecto?: string): string {
  const v = process.env[nombre] ?? defecto;
  if (v === undefined || v === '') throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

const produccion = process.env.NODE_ENV === 'production';

export const config = {
  produccion,
  puerto: Number(process.env.PORT ?? 3000),
  databaseUrl: env('DATABASE_URL', 'postgres://nuvamail:nuvamail@localhost/nuvamail'),
  jwtSecreto: env('JWT_SECRET', produccion ? undefined : 'solo-desarrollo-cambiar-en-produccion-0123456789'),
  bajaSecreto: env('UNSUB_SECRET', produccion ? undefined : 'solo-desarrollo-baja-0123456789'),
  urlPublica: env('PUBLIC_URL', process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  origenWeb: env('WEB_ORIGIN', process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:4200'),
  awsRegion: env('AWS_REGION', 'us-east-1'),
  sesConfigSet: process.env.SES_CONFIGURATION_SET ?? 'nuvamail',
  snsTopicArn: process.env.SNS_TOPIC_ARN ?? '',
  // simulacion: no envía a SES; genera eventos realistas para probar reportes
  simulacion: (process.env.DRY_RUN ?? 'true').toLowerCase() === 'true',
  s3Bucket: process.env.S3_BUCKET ?? '',
  s3UrlPublica: (process.env.S3_PUBLIC_URL ?? '').replace(/\/$/, ''),
  trabajadorActivo: (process.env.WORKER ?? 'true').toLowerCase() === 'true',
};
