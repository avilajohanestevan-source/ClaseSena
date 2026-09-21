// Datos de prueba del servidor simulado. Se generan en memoria al cargar
// la página, con las clases de hoy calculadas alrededor de la hora actual
// para que siempre haya una ventana abierta. Recargar la página los
// reinicia: no hay persistencia.

export const PASSWORD_PRUEBA = 'Sena2026*';

export const USUARIOS_PRUEBA = [
  { id: 'U-INS-1', identificacion: '1010101010', nombre: 'Laura Gómez Patiño', rol: 'instructor', ambienteIds: ['AMB-201', 'AMB-105'] },
  { id: 'U-ADM-1', identificacion: '2020202020', nombre: 'Carlos Méndez Ruiz', rol: 'administrativo' },
  { id: 'AP-2758432-01', identificacion: '1122334455', nombre: 'Camila Rojas Herrera', rol: 'aprendiz', ficha: '2758432' },
  // Cuenta bloqueada: sirve para probar el manejo de errores del login.
  { id: 'U-INS-2', identificacion: '3030303030', nombre: 'Andrés Salazar', rol: 'instructor', bloqueado: true },
];

const AMBIENTES = [
  { id: 'AMB-201', nombre: 'Ambiente 201 · Sistemas', sede: 'Sede Villeta' },
  { id: 'AMB-105', nombre: 'Laboratorio 105 · Electrónica', sede: 'Sede Villeta' },
  { id: 'AMB-T3', nombre: 'Taller 3 · Mecánica', sede: 'Sede Villeta' },
];

const COMPETENCIAS = [
  { id: 'C-220501096', nombre: 'Desarrollar la solución de software' },
  { id: 'C-220501095', nombre: 'Construir el sistema de información' },
  { id: 'C-280201031', nombre: 'Mantener equipos electrónicos' },
  { id: 'C-280201045', nombre: 'Diagnosticar circuitos digitales' },
];

const FICHAS = [
  { ficha: '2758432', programa: 'Análisis y Desarrollo de Software', ambienteId: 'AMB-201', competencias: ['C-220501096', 'C-220501095'] },
  { ficha: '2834519', programa: 'Tecnólogo en Electrónica', ambienteId: 'AMB-105', competencias: ['C-280201031', 'C-280201045'] },
];

const NOMBRES = [
  'Camila Rojas Herrera', 'Santiago Pérez Lozano', 'Valentina Cruz Díaz', 'Mateo Torres Ramírez',
  'Isabella Moreno Castro', 'Samuel Vargas Ortiz', 'Mariana Jiménez Ríos', 'Nicolás Castillo Peña',
  'Daniela Suárez León', 'Sebastián Herrera Mora', 'Laura Parra Guzmán', 'Juan David Rincón',
  'Sara Cárdenas Vega', 'Tomás Beltrán Rojas', 'Gabriela Acosta Niño', 'Felipe Duarte Silva',
  'Ana María Quintero', 'Julián Ospina Reyes', 'Paula Andrea Muñoz', 'David Esteban Gil',
  'Luisa Fernanda Ruiz', 'Andrés Camilo Pardo',
];

// Probabilidad de falta por aprendiz y racha forzada al final, para que el
// semáforo muestre todos los colores.
const PERFILES = [
  { p: 0.02, racha: 0 }, { p: 0.08, racha: 0 }, { p: 0.15, racha: 1 }, { p: 0.05, racha: 0 },
  { p: 0.3, racha: 2 }, { p: 0.1, racha: 0 }, { p: 0.45, racha: 3 }, { p: 0.02, racha: 0 },
  { p: 0.2, racha: 0 }, { p: 0.6, racha: 4 }, { p: 0.12, racha: 1 }, { p: 0.05, racha: 0 },
];

// Generador pseudoaleatorio con semilla: los mismos datos en cada carga.
function aleatorio(semilla) {
  let s = semilla >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function placeholderFoto(texto, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
<rect width="480" height="320" fill="${color}"/><rect x="24" y="24" width="432" height="272" rx="16" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-dasharray="10 8"/>
<circle cx="240" cy="140" r="38" fill="none" stroke="#fff" stroke-width="5"/><rect x="186" y="104" width="108" height="76" rx="12" fill="none" stroke="#fff" stroke-width="5"/>
<text x="240" y="238" font-family="Work Sans, Arial" font-size="22" font-weight="600" fill="#fff" text-anchor="middle">${texto}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function horaDelDia(base, dias, horas, minutos) {
  const d = new Date(base);
  d.setDate(d.getDate() + dias);
  d.setHours(horas, minutos, 0, 0);
  return d;
}

function diasHabilesAtras(ahora, cantidad) {
  const dias = [];
  for (let i = 1; dias.length < cantidad; i++) {
    const d = new Date(ahora);
    d.setDate(d.getDate() - i);
    if (d.getDay() !== 0 && d.getDay() !== 6) dias.unshift(-i);
  }
  return dias;
}

export function crearBaseDatos(ahora = Date.now()) {
  const rnd = aleatorio(2758432);
  const competencia = (id) => COMPETENCIAS.find((c) => c.id === id);
  const ambiente = (id) => AMBIENTES.find((a) => a.id === id);

  // Aprendices por ficha (12 en ADSO, 10 en Electrónica).
  const aprendices = [];
  FICHAS.forEach((f, fi) => {
    const cantidad = fi === 0 ? 12 : 10;
    for (let i = 0; i < cantidad; i++) {
      const n = fi * 12 + i;
      aprendices.push({
        id: `AP-${f.ficha}-${String(i + 1).padStart(2, '0')}`,
        documento: n === 0 ? '1122334455' : String(1000200300 + n * 7919),
        nombre: NOMBRES[n],
        ficha: f.ficha,
        programa: f.programa,
        perfil: PERFILES[i % PERFILES.length],
      });
    }
  });

  // Sesiones pasadas (10 días hábiles) y las de hoy.
  const sesiones = [];
  const asistencias = [];
  const dias = diasHabilesAtras(ahora, 10);
  FICHAS.forEach((f, fi) => {
    dias.forEach((dia, di) => {
      const compId = f.competencias[di % 2];
      const inicio = horaDelDia(ahora, dia, fi === 0 ? 7 : 13, 0);
      const cancelada = fi === 1 && di === 6;
      const s = {
        id: `S-${f.ficha}-${di + 1}`, ficha: f.ficha, programa: f.programa,
        competenciaId: compId, competencia: competencia(compId).nombre,
        ambienteId: f.ambienteId, ambiente: ambiente(f.ambienteId).nombre,
        instructorId: 'U-INS-1', instructor: 'Laura Gómez Patiño',
        startTime: inicio.toISOString(), endTime: new Date(inicio.getTime() + 4 * 3600_000).toISOString(),
        ventanaMin: 15, cancelada, motivoCancelacion: cancelada ? 'Corte de energía en la sede' : undefined,
      };
      sesiones.push(s);
      aprendices.filter((a) => a.ficha === f.ficha).forEach((a) => {
        const enRacha = di >= dias.length - a.perfil.racha;
        let estado;
        if (cancelada) estado = 'cancelada';
        else if (enRacha || rnd() < a.perfil.p) estado = 'falla';
        else estado = rnd() < 0.15 ? 'tarde' : 'presente';
        const minuto = estado === 'tarde' ? 6 + Math.floor(rnd() * 8) : Math.floor(rnd() * 5);
        asistencias.push({
          id: `R-${s.id}-${a.id}`, sessionId: s.id, aprendizId: a.id, documento: a.documento, aprendiz: a.nombre,
          ficha: a.ficha, competenciaId: compId, competencia: s.competencia, ambienteId: s.ambienteId, ambiente: s.ambiente,
          fecha: s.startTime,
          hora: estado === 'presente' || estado === 'tarde' ? new Date(inicio.getTime() + minuto * 60_000).toISOString() : undefined,
          estado,
        });
      });
    });
  });

  // Hoy: una clase con la ventana abierta (empezó hace 3 min), una que ya
  // cerró y una que empieza más tarde.
  const hoy = [
    { ficha: FICHAS[0], compId: 'C-220501096', inicio: ahora - 3 * 60_000, ventanaMin: 15, sufijo: 'hoy-a' },
    { ficha: FICHAS[1], compId: 'C-280201031', inicio: ahora - 150 * 60_000, ventanaMin: 15, sufijo: 'hoy-b' },
    { ficha: FICHAS[0], compId: 'C-220501095', inicio: ahora + 50 * 60_000, ventanaMin: 20, sufijo: 'hoy-c' },
  ];
  hoy.forEach(({ ficha: f, compId, inicio, ventanaMin, sufijo }) => {
    const inicioRedondo = new Date(inicio); inicioRedondo.setSeconds(0, 0);
    sesiones.push({
      id: `S-${f.ficha}-${sufijo}`, ficha: f.ficha, programa: f.programa,
      competenciaId: compId, competencia: competencia(compId).nombre,
      ambienteId: f.ambienteId, ambiente: ambiente(f.ambienteId).nombre,
      instructorId: 'U-INS-1', instructor: 'Laura Gómez Patiño',
      startTime: inicioRedondo.toISOString(), endTime: new Date(inicioRedondo.getTime() + 3 * 3600_000).toISOString(),
      ventanaMin, cancelada: false,
    });
  });
  // Algunos compañeros ya se registraron en la clase abierta.
  aprendices.filter((a) => a.ficha === '2758432').slice(1, 6).forEach((a, i) => {
    const s = sesiones.find((x) => x.id === 'S-2758432-hoy-a');
    asistencias.push({
      id: `R-${s.id}-${a.id}`, sessionId: s.id, aprendizId: a.id, documento: a.documento, aprendiz: a.nombre,
      ficha: a.ficha, competenciaId: s.competenciaId, competencia: s.competencia, ambienteId: s.ambienteId, ambiente: s.ambiente,
      fecha: s.startTime, hora: new Date(Date.parse(s.startTime) + (i + 1) * 25_000).toISOString(), estado: 'presente',
    });
  });

  // Inventario por ambiente.
  const colores = ['#00304D', '#007832', '#71277A', '#4D4D4D'];
  const catalogo = {
    'AMB-201': [['Computador de escritorio', 'Cómputo', 6], ['Video beam Epson', 'Audiovisual', 1], ['Switch 24 puertos', 'Redes', 1], ['Aire acondicionado', 'Infraestructura', 1], ['Silla ergonómica', 'Mobiliario', 2]],
    'AMB-105': [['Osciloscopio digital', 'Medición', 2], ['Fuente de poder DC', 'Medición', 2], ['Multímetro Fluke', 'Medición', 3], ['Estación de soldadura', 'Herramienta', 2]],
    'AMB-T3': [['Torno paralelo', 'Maquinaria', 1], ['Taladro de banco', 'Maquinaria', 2], ['Compresor de aire', 'Maquinaria', 1]],
  };
  const activos = [];
  Object.entries(catalogo).forEach(([ambId, items]) => {
    let n = 0;
    items.forEach(([nombre, tipo, cant]) => {
      for (let i = 0; i < cant; i++) {
        n++;
        const codigo = `SENA-${ambId.replace('AMB-', '')}-${String(n).padStart(4, '0')}`;
        const r = rnd();
        const estado = r < 0.12 ? 'danado' : r < 0.2 ? 'en-reparacion' : 'operativo';
        const alta = horaDelDia(ahora, -300 - Math.floor(rnd() * 200), 9, 0).toISOString();
        const historial = [{ fecha: alta, evento: 'Alta en inventario', usuario: 'Almacén' }];
        const fotos = [];
        if (estado !== 'operativo') {
          const fecha = horaDelDia(ahora, -2 - Math.floor(rnd() * 20), 10, 30).toISOString();
          historial.push({ fecha, evento: 'Reporte de daño (moderada)', usuario: 'Laura Gómez Patiño' });
          fotos.push({ url: placeholderFoto(`${nombre} · daño`, colores[n % colores.length]), fecha, descripcion: 'Falla reportada en inspección' });
          if (estado === 'en-reparacion') historial.push({ fecha, evento: 'Enviado a mantenimiento', usuario: 'Carlos Méndez Ruiz' });
        }
        activos.push({
          id: `ACT-${codigo}`, codigo, nombre: cant > 1 ? `${nombre} #${i + 1}` : nombre, tipo, ambienteId: ambId,
          estado, serial: 'SN' + Math.floor(rnd() * 1e9).toString(36).toUpperCase(), historial, fotos,
        });
      }
    });
  });

  // P004 con el estado académico de cada aprendiz.
  const p004 = aprendices.map((a, i) => ({
    documento: a.documento, nombre: a.nombre, ficha: a.ficha, programa: a.programa,
    estado: i === 9 ? 'CONDICIONADO' : i === 18 ? 'RETIRO VOLUNTARIO' : 'EN FORMACION',
    actualizadoPor: 'Importación inicial', actualizadoEn: horaDelDia(ahora, -30, 8, 0).toISOString(),
  }));

  const notificaciones = [
    { id: 'N-1', tipo: 'dano-grave', titulo: 'Daño grave reportado', detalle: 'Aire acondicionado · Ambiente 201', fecha: new Date(ahora - 26 * 3600_000).toISOString(), leida: false },
    { id: 'N-2', tipo: 'clase-cancelada', titulo: 'Clase cancelada', detalle: 'Ficha 2834519 · Corte de energía en la sede', fecha: new Date(ahora - 4 * 86400_000).toISOString(), leida: true },
  ];

  return {
    usuarios: USUARIOS_PRUEBA, ambientes: AMBIENTES, competencias: COMPETENCIAS, fichas: FICHAS,
    aprendices, sesiones, asistencias, activos, p004, notificaciones, danos: [], qrEmitidos: {},
  };
}
