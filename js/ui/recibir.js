// Cierre de la entrega con QR, en los dos sentidos:
//  · escanearEntrega (instructor): escanea el QR que muestra el portero.
//  · escanearQrInstructor (portero): escanea el QR de entrega que muestra el instructor.
// Al leerlo, el servidor guarda quién entregó (portero_id), quién recibió
// (instructor_id), la hora y el estado de los ítems (y avisa a coordinación si
// hay daños). Luego se abre la planilla con el aviso correspondiente.
import { vibrar } from './dom.js';
import { toast, abrirModal } from './avisos.js';
import { crearEscaner } from './escaner.js';
import { apiAmb } from '../api/ambientes.js';
import { emitir } from '../estado.js';
import { leerQrInspeccion, leerQrEntrega } from '../reglas.js';

export function escanearEntrega() {
  let escaner, ocupado = false;
  const { cerrar } = abrirModal({
    titulo: 'Recibir ambiente',
    subtitulo: 'Escanea el código QR que te muestra el portero en su celular.',
    ancho: 'angosto',
    contenido: () => {
      escaner = crearEscaner({
        tipos: ['qr'], etiqueta: 'Abrir cámara', placeholder: 'SENA-INSP:…',
        alLeer: async (texto) => {
          if (ocupado) return;
          const token = leerQrInspeccion(texto);
          if (!token) { toast('error', 'Ese QR no es de una entrega de ambiente', texto.slice(0, 60)); return; }
          ocupado = true;
          try {
            const s = await apiAmb.recibirPorQr(token);
            vibrar(60);
            cerrar();
            emitir('inspecciones');
            location.hash = `#/planilla?id=${s.id}&recibida=1`;
          } catch (e) {
            toast('error', 'No se pudo recibir el ambiente', e.message);
            ocupado = false;
          }
        },
      });
      return escaner.el;
    },
    alCerrar: () => escaner?.detener(),
  });
}

export function escanearQrInstructor() {
  let escaner, ocupado = false;
  const { cerrar } = abrirModal({
    titulo: 'Confirmar entrega',
    subtitulo: 'Escanea el QR de entrega que te muestra el instructor en su celular.',
    ancho: 'angosto',
    contenido: () => {
      escaner = crearEscaner({
        tipos: ['qr'], etiqueta: 'Abrir cámara', placeholder: 'SENA-ENT:…',
        alLeer: async (texto) => {
          if (ocupado) return;
          const token = leerQrEntrega(texto);
          if (!token) { toast('error', 'Ese QR no es el de entrega de un instructor', texto.slice(0, 60)); return; }
          ocupado = true;
          try {
            const s = await apiAmb.confirmarQrInstructor(token);
            vibrar(60);
            cerrar();
            emitir('inspecciones');
            location.hash = `#/planilla?id=${s.id}&entregada=1`;
          } catch (e) {
            toast('error', 'No se pudo confirmar la entrega', e.message);
            ocupado = false;
          }
        },
      });
      return escaner.el;
    },
    alCerrar: () => escaner?.detener(),
  });
}
