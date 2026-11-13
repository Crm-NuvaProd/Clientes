import { generateKeyPairSync, createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { revisar } from './campanas/revision.js';
import { esMpp } from './envio/eventos.service.js';
import { crearTokenBaja, leerTokenBaja } from './envio/token-baja.js';
import { topeDelDia } from './envio/trabajador.service.js';
import { calcularVeredicto } from './estadisticas/veredicto.js';
import { limpiarCorreo, limpiarTexto, personalizar, renderizar } from './plantillas/render.js';
import { verificarSns } from './publico/publico.controller.js';

const kpisBase = {
  destinatarios: 1000, enviados: 1000, enCola: 0, omitidos: 0, fallidos: 0, entregados: 990, rebotesDuros: 3, rebotesSuaves: 7,
  rechazados: 0, quejas: 0, bajas: 2, aperturasUnicas: 300, aperturasTotales: 420, aperturasMpp: 20, clicsUnicos: 40, clicsTotales: 55,
  tasaEntrega: 0.99, tasaRebote: 0.003, tasaApertura: 0.30, tasaAperturaSinMpp: 0.28, tasaClic: 0.04, ctor: 0.13, tasaBaja: 0.002, tasaQueja: 0,
};

describe('veredicto de campaña', () => {
  it('campaña sana = exitosa', () => {
    const v = calcularVeredicto(kpisBase);
    expect(v.nivel).toBe('exitosa');
    expect(v.puntaje).toBeGreaterThanOrEqual(80);
  });
  it('quejas altas = problema de entregabilidad aunque abran mucho', () => {
    const v = calcularVeredicto({ ...kpisBase, tasaQueja: 0.004 });
    expect(v.nivel).toBe('problema_entregabilidad');
    expect(v.recomendaciones.join(' ')).toMatch(/Quejas/);
  });
  it('compara con el promedio reciente', () => {
    const v = calcularVeredicto({ ...kpisBase, tasaAperturaSinMpp: 0.18 }, 0.30);
    expect(v.recomendaciones.join(' ')).toMatch(/menos que su promedio/);
  });
});

describe('revisión antispam', () => {
  const base = { asunto: '{{nombre}}, planee su producción', preencabezado: 'x', html: '<p>Hola {{nombre}}</p><a href="{{url_baja}}">baja</a>',
    dominioEnvio: 'mail.nuvaprod.com', fromEmail: 'm@mail.nuvaprod.com', destinatarios: 10, topeDiario: 500 };
  it('sin problemas', () => expect(revisar(base)[0].nivel).toBe('ok'));
  it('bloquea acortadores, RE: y remitente gmail', () => {
    const r = revisar({ ...base, asunto: 'RE: GRATIS!!!', fromEmail: 'yo@gmail.com', html: base.html + '<a href="https://bit.ly/x">x</a>' });
    const errores = r.filter((i) => i.nivel === 'error').map((i) => i.mensaje).join(' | ');
    expect(errores).toMatch(/acortadores/);
    expect(errores).toMatch(/RE:/);
    expect(errores).toMatch(/Gmail/);
  });
  it('exige enlace de baja', () => expect(revisar({ ...base, html: '<p>x</p>' }).some((i) => /baja/.test(i.mensaje))).toBe(true));
});

describe('baja y seguridad', () => {
  it('token de baja firmado', () => {
    const t = crearTokenBaja('2d3c9c7d-1c4f-4ac8-b7c1-a8f926fdd6ea', 42, null);
    expect(leerTokenBaja(t)).toEqual({ empresaId: '2d3c9c7d-1c4f-4ac8-b7c1-a8f926fdd6ea', contactoId: 42, campanaId: null });
    expect(leerTokenBaja(t.slice(0, -2) + 'xx')).toBeNull();
  });
  it('personalización escapa HTML y no ejecuta código', () => {
    const v = { nombre: '<img src=x onerror=alert(1)>', nombre_completo: '', empresa: '', ciudad: '', cargo: '', email: 'a@b.co', url_baja: 'https://x/u/t' };
    expect(personalizar('Hola {{ nombre }} {{ constructor }}', v, true)).toBe('Hola &lt;img src=x onerror=alert(1)&gt; {{ constructor }}');
    expect(personalizar('{{empresa|"su empresa"}}', v, false)).toBe('su empresa');
  });
  it('limpia scripts y eventos de piezas importadas', () => {
    const h = limpiarCorreo('<table><tr><td onclick="x()">Hola<script>alert(1)</script><iframe src="x"></iframe><a href="javascript:alert(1)">a</a></td></tr></table>');
    expect(h).not.toMatch(/script|onclick|iframe|javascript:/);
    expect(limpiarTexto('<p style="color:#ff0000;position:fixed">x</p>')).toBe('<p style="color:#ff0000">x</p>');
  });
  it('detecta aperturas automáticas de Apple', () => {
    expect(esMpp('Mozilla/5.0')).toBe(true);
    expect(esMpp('Mozilla/5.0 (Windows NT 10.0) Chrome/120')).toBe(false);
  });
});

describe('calentamiento', () => {
  const e = { warmup_inicio: '2026-11-10', warmup_plan: [500, 1000, 2000], tope_diario: 10000 };
  it('sube por días y se queda en el último', () => {
    expect(topeDelDia(e, new Date('2026-11-10T15:00:00Z')).tope).toBe(500);
    expect(topeDelDia(e, new Date('2026-11-12T15:00:00Z')).tope).toBe(2000);
    expect(topeDelDia(e, new Date('2026-12-30T15:00:00Z')).tope).toBe(2000);
    expect(topeDelDia({ ...e, warmup_inicio: null }).tope).toBe(10000);
  });
});

describe('render MJML', () => {
  it('genera HTML responsive con pie y baja', async () => {
    const { html } = await renderizar({ formato: 'nuvamail/1', ajustes: {} as any, bloques: [
      { id: '1', tipo: 'texto', html: '<p>Hola {{nombre}}</p>' },
      { id: '2', tipo: 'boton', texto: 'Ver', url: 'javascript:alert(1)' },
      { id: '3', tipo: 'redes', enlaces: [{ red: 'linkedin', url: 'https://linkedin.com/company/x' }] },
    ] }, 'pre', { texto: 'NuvaProd', urlPolitica: '', direccion: '' });
    expect(html).toContain('{{url_baja}}');
    expect(html).toContain('Hola {{nombre}}');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('shareArticle');
  });
});

describe('firma SNS', () => {
  it('acepta solo mensajes firmados por el certificado y rechaza alterados', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sns-'));
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    writeFileSync(path.join(dir, 'k.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
    execFileSync('openssl', ['req', '-new', '-x509', '-key', path.join(dir, 'k.pem'), '-subj', '/CN=sns.amazonaws.com', '-days', '1', '-out', path.join(dir, 'c.pem')]);
    const cert = readFileSync(path.join(dir, 'c.pem'), 'utf8');
    const m: any = { Type: 'Notification', MessageId: '1', TopicArn: 'arn:aws:sns:us-east-1:1:t', Timestamp: '2026-11-13T00:00:00Z',
      Message: '{"eventType":"Delivery"}', SignatureVersion: '2', SigningCertURL: 'https://sns.us-east-1.amazonaws.com/c.pem' };
    const texto = ['Message', 'MessageId', 'Timestamp', 'TopicArn', 'Type'].map((k) => `${k}\n${m[k]}\n`).join('');
    m.Signature = createSign('RSA-SHA256').update(texto).sign(privateKey, 'base64');
    expect(await verificarSns(m, async () => cert)).toBe(true);
    expect(await verificarSns({ ...m, Message: '{"eventType":"Complaint"}' }, async () => cert)).toBe(false);
    expect(await verificarSns({ ...m, SigningCertURL: 'https://evil.com/c.pem' }, async () => cert)).toBe(false);
  });
});
