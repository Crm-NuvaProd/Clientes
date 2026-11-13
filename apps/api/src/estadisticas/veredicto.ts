import type { Kpis, Veredicto } from '@nuvamail/contratos';

/**
 * Referencias para correo B2B a pymes manufactureras en Latinoamérica.
 * Las aperturas se miden SIN las automáticas de Apple (MPP), que inflan la cifra.
 */
export const REFERENCIAS = {
  entrega: { bien: 0.98, regular: 0.95 },
  reboteDuro: { bien: 0.005, regular: 0.02 },       // Brevo suspende por encima de 2 %
  queja: { bien: 0.0005, regular: 0.001 },          // Gmail exige < 0,3 %; lo sano es < 0,1 %
  apertura: { bien: 0.25, regular: 0.15 },
  clic: { bien: 0.025, regular: 0.01 },
  ctor: { bien: 0.10, regular: 0.06 },
  baja: { bien: 0.003, regular: 0.008 },
};

type Estado = 'bien' | 'regular' | 'mal';
const mayor = (v: number, r: { bien: number; regular: number }): Estado => (v >= r.bien ? 'bien' : v >= r.regular ? 'regular' : 'mal');
const menor = (v: number, r: { bien: number; regular: number }): Estado => (v <= r.bien ? 'bien' : v <= r.regular ? 'regular' : 'mal');
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d).replace('.', ',')} %`;
const PUNTOS: Record<Estado, number> = { bien: 1, regular: 0.55, mal: 0 };

export function calcularVeredicto(k: Kpis, promedioApertura?: number): Veredicto {
  const ind = [
    { nombre: 'Tasa de entrega', valor: k.tasaEntrega, referencia: `≥ ${pct(REFERENCIAS.entrega.bien, 0)}`, estado: mayor(k.tasaEntrega, REFERENCIAS.entrega), peso: 20 },
    { nombre: 'Rebote duro', valor: k.tasaRebote, referencia: `≤ ${pct(REFERENCIAS.reboteDuro.bien)}`, estado: menor(k.tasaRebote, REFERENCIAS.reboteDuro), peso: 15 },
    { nombre: 'Quejas por spam', valor: k.tasaQueja, referencia: `≤ ${pct(REFERENCIAS.queja.bien, 2)}`, estado: menor(k.tasaQueja, REFERENCIAS.queja), peso: 20 },
    { nombre: 'Apertura real (sin Apple MPP)', valor: k.tasaAperturaSinMpp, referencia: `≥ ${pct(REFERENCIAS.apertura.bien, 0)}`, estado: mayor(k.tasaAperturaSinMpp, REFERENCIAS.apertura), peso: 15 },
    { nombre: 'Clics / entregados (CTR)', valor: k.tasaClic, referencia: `≥ ${pct(REFERENCIAS.clic.bien)}`, estado: mayor(k.tasaClic, REFERENCIAS.clic), peso: 15 },
    { nombre: 'Clics / aperturas (CTOR)', valor: k.ctor, referencia: `≥ ${pct(REFERENCIAS.ctor.bien, 0)}`, estado: mayor(k.ctor, REFERENCIAS.ctor), peso: 10 },
    { nombre: 'Bajas', valor: k.tasaBaja, referencia: `≤ ${pct(REFERENCIAS.baja.bien)}`, estado: menor(k.tasaBaja, REFERENCIAS.baja), peso: 5 },
  ];
  const puntaje = Math.round(ind.reduce((s, i) => s + i.peso * PUNTOS[i.estado], 0));
  const r: string[] = [];
  const e = (n: string) => ind.find((i) => i.nombre === n)!.estado;

  if (e('Rebote duro') !== 'bien') r.push(`Rebote duro de ${pct(k.tasaRebote)}: la lista tiene correos viejos o mal escritos. Los rebotados ya quedaron suprimidos; antes de la próxima campaña importe solo contactos verificados y active la verificación MX.`);
  if (e('Quejas por spam') !== 'bien') r.push(`Quejas de ${pct(k.tasaQueja, 2)}: hay destinatarios que no esperan sus correos. Envíe solo a quien autorizó, deje el enlace de baja visible arriba y active la exclusión de inactivos.`);
  if (e('Tasa de entrega') !== 'bien') r.push('Entrega baja: revise en Entregabilidad que SPF, DKIM y DMARC estén en verde y mire los motivos de rebote por dominio.');
  if (e('Apertura real (sin Apple MPP)') !== 'bien') r.push('Aperturas bajas: pruebe asuntos más concretos (30–50 caracteres, con el beneficio y {{nombre}}), use preencabezado, y haga prueba A/B del asunto con el 20 % de la lista.');
  if (e('Clics / aperturas (CTOR)') !== 'bien') r.push('Leen pero no hacen clic: un solo llamado a la acción, botón visible arriba, y un beneficio claro (demo, caso de un cliente del mismo sector).');
  if (e('Bajas') !== 'bien') r.push('Bajas altas: baje la frecuencia o segmente por sector (alimentos, plásticos, textil…) para que el mensaje sea más relevante.');
  if (k.aperturasMpp > 0 && k.aperturasUnicas > 0 && k.aperturasMpp / k.aperturasUnicas > 0.3)
    r.push(`El ${pct(k.aperturasMpp / k.aperturasUnicas, 0)} de las aperturas son automáticas de Apple: juzgue la campaña por clics, no por aperturas.`);
  if (promedioApertura !== undefined && promedioApertura > 0 && k.tasaAperturaSinMpp < promedioApertura * 0.8)
    r.push(`Abrió un ${pct(1 - k.tasaAperturaSinMpp / promedioApertura, 0)} menos que su promedio reciente: compare asunto, día y hora de envío.`);
  if (!r.length) r.push('Campaña sana. Repita el formato y pruebe una variable a la vez (asunto, día de envío o llamado a la acción).');

  const entregabilidadMal = e('Quejas por spam') === 'mal' || e('Rebote duro') === 'mal' || e('Tasa de entrega') === 'mal';
  const nivel: Veredicto['nivel'] = entregabilidadMal ? 'problema_entregabilidad' : puntaje >= 80 ? 'exitosa' : puntaje >= 60 ? 'aceptable' : 'por_mejorar';
  const titulo = { exitosa: 'Campaña exitosa', aceptable: 'Campaña aceptable', por_mejorar: 'Campaña por mejorar', problema_entregabilidad: 'Problema de entregabilidad' }[nivel];
  return { puntaje, nivel, titulo, indicadores: ind.map(({ peso: _p, ...i }) => i), recomendaciones: r };
}
