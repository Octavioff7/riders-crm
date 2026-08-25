/* ============================================================
   Riders Miami CRM — Asistente de WhatsApp para leads de anuncios
   ------------------------------------------------------------
   Contesta a la gente que escribe desde los anuncios de Facebook,
   habla con el tono de Octa (se aprende de sus chats reales), junta
   los 5 datos que hacen falta para calificar el lead, y después se
   lo pasa a un humano para la llamada.

   Este módulo NO manda nada por su cuenta: devuelve los mensajes ya
   escritos y quien lo llama decide si los envía por la API de
   WhatsApp o si es una simulación de prueba desde el CRM.
   ============================================================ */

/* Los 5 datos del filtro. Si junta 4 de 5 el lead queda listo para llamar. */
const CAMPOS = [
  { id: 'producto', label: 'Qué producto le interesa' },
  { id: 'destino', label: 'Para Miami o envío a Cuba' },
  { id: 'pago', label: 'Cash o financiado' },
  { id: 'urgencia', label: 'Para cuándo lo quiere' },
  { id: 'contacto', label: 'Nombre y horario para llamarlo' }
];
const MIN_CAMPOS = 4; // con 4 de 5 ya se le pasa a Octa

/* Configuración por defecto. Se guarda en DATA_DIR/asistente.json y
   Octa la edita desde el CRM (sección "Asistente IA"). El bloque de
   estilo y los ejemplos son PROVISORIOS: se reemplazan con el tono
   real sacado de sus conversaciones exportadas de WhatsApp. */
const DEFAULT_CFG = {
  activo: false,              // apagado hasta que haya número de WhatsApp conectado
  soloAnuncios: true,         // solo contesta a quien llega por un anuncio (m.referral)
  simulacion: true,           // true = no envía por WhatsApp aunque haya credenciales
  agente: 'Octavio',
  negocio: 'Riders Miami',
  maxMensajes: 12,            // tope de mensajes del bot en una charla; después pasa a humano
  delayMin: 10,               // segundos mínimos antes de contestar (para no parecer un robot)
  delayMax: 45,
  horaDesde: '08:00',         // fuera de este horario espera hasta la mañana
  horaHasta: '22:00',
  avisarPush: true,           // push al celu cuando un lead queda listo para llamar
  estilo: [
    'Escribí en español de Miami, como se le habla a un cliente cubano.',
    'Usá "tú" SIEMPRE (tienes, quieres, para ti). Nunca "usted" y nunca "vos".',
    'Mensajes de una o dos líneas. Cortos.',
    'Sin emojis, o como mucho uno cada varios mensajes.',
    'Empezá directo, sin "Hola, ¿cómo estás? Espero que te encuentres bien".'
  ].join('\n'),
  ejemplos: [
    { cliente: 'Hola, precio de la moto?', yo: 'Hola! Cuál te gustó, la de la foto del anuncio?' },
    { cliente: 'si esa', yo: 'Esa es la Titan 250cc, sale 4500 cash.\nEs para ti aquí o para mandarla a Cuba?' },
    { cliente: 'para mandar a cuba, se puede financiar?', yo: 'Sí, financiamos. Hay varias opciones según tu crédito.\nDe cuánto tienes el score más o menos?' },
    { cliente: 'no se, nunca lo mire', yo: 'No hay problema, lo chequeamos juntos en un minuto.\nA qué hora te viene bien que te llame?' }
  ],
  cierre: 'Dale, te llamo {horario} y lo cerramos. Cualquier cosa escríbeme.'
};

function crearAsistente(dep) {
  const { fs, path, DATA_DIR, geminiChain, hoy, ahora } = dep;
  const APATH = path.join(DATA_DIR, 'asistente.json');

  function cargarCfg() {
    let c = {};
    try { c = JSON.parse(fs.readFileSync(APATH, 'utf8')); } catch (e) { c = {}; }
    return Object.assign({}, DEFAULT_CFG, c);
  }
  function guardarCfg(c) {
    const merged = Object.assign({}, DEFAULT_CFG, c || {});
    try { fs.writeFileSync(APATH, JSON.stringify(merged, null, 1)); } catch (e) { }
    return merged;
  }

  /* ---------- Estado del filtro ---------- */
  function estadoFiltro(cliente) {
    const d = (cliente && cliente.asis && cliente.asis.datos) || {};
    const completos = CAMPOS.filter(f => String(d[f.id] || '').trim()).map(f => f.id);
    const faltan = CAMPOS.filter(f => !completos.includes(f.id));
    return {
      completos, faltan,
      n: completos.length, total: CAMPOS.length,
      pct: Math.round(completos.length / CAMPOS.length * 100),
      listo: completos.length >= MIN_CAMPOS
    };
  }

  /* ---------- Detectores que NO le dejamos a la IA ----------
     Estas son las salidas de emergencia. Van por regex porque tienen
     que dispararse siempre, aunque el modelo se equivoque. */
  const RE_BOT = /\b(sos|eres|soy hablando con|est(o|oy hablando con)|es)\s*(un[ao]?\s*)?(bot|robot|m[aá]quina|maquina|ia|inteligencia artificial|chatgpt|gpt|contestador autom[aá]tico)\b|\bes autom[aá]tico\b|\bes un[ao]? (bot|ia|m[aá]quina)\b|\bhablo con (una )?(persona|humano|alguien real)\b|\bhay alguien (real|ah[ií])\b/i;
  const RE_ENOJO = /\b(estafa|estafador|ladron|ladr[oó]n|denuncia|abogado|devolucion|devoluci[oó]n|reclamo|me robaron|basura|porqueria|porquer[ií]a)\b/i;
  // OJO: acá NO va "llamame". Que el cliente pida que lo llamen es justo lo que
  // queremos que pase — no es un pedido de escalar a un humano.
  const RE_HUMANO = /\b(quiero hablar con|pasame con|p[aá]same con|comunicame con|com[uú]nicame con|me atiende|que me atienda)\s*(un|una|el|la)?\s*(persona|humano|vendedor|encargado|due[ñn]o|jefe)\b/i;

  function esPreguntaBot(t) { return RE_BOT.test(String(t || '')); }
  function pideHumano(t) { return RE_ENOJO.test(String(t || '')) || RE_HUMANO.test(String(t || '')); }
  function esNoTexto(t) { return /^\[(audio|image|imagen|video|document|sticker|location|ubicaci[oó]n|voice)/i.test(String(t || '').trim()); }

  /* ---------- Catálogo real para el prompt ----------
     Solo nombre + precio de lista. Nunca comisiones ni fees: eso es
     margen interno y el cliente no lo tiene que ver nunca. */
  /* La categoría "kit" del inventario mezcla kits solares completos con
     paneles, baterías e inversores sueltos. Si se los damos juntos, la IA
     contesta "kits desde $230" cuando esos $230 son un panel solo. */
  const esKitCompleto = p => /^kit\b/i.test(String(p.nombre || ''));
  function catalogoTexto(inv) {
    const act = (inv || []).filter(p => p && p.activo !== false);
    const linea = p => `- ${p.nombre}${p.motor ? ' (' + p.motor + ')' : ''}: $${p.precio}`;
    const grupo = f => act.filter(f).map(linea).join('\n');
    return [
      'MOTOS:\n' + (grupo(p => p.cat === 'moto') || '(sin stock cargado)'),
      'TRICICLOS:\n' + (grupo(p => p.cat === 'triciclo') || '(sin stock cargado)'),
      'KITS SOLARES COMPLETOS:\n' + (grupo(p => p.cat === 'kit' && esKitCompleto(p)) || '(sin stock cargado)'),
      'EQUIPOS Y REPUESTOS SUELTOS (esto NO es un kit completo, no lo ofrezcas como si lo fuera):\n'
      + (grupo(p => p.cat === 'kit' && !esKitCompleto(p)) || '(nada cargado)')
    ].join('\n\n');
  }
  /* Los modelos de IA son malos buscando el mínimo de una lista larga: en la
     prueba dijo que la moto más barata era de $3600 cuando hay una de $1600.
     Se lo calculamos nosotros y se lo damos masticado. */
  function masBaratosTexto(inv) {
    const act = (inv || []).filter(p => p && p.activo !== false && Number(p.precio) > 0);
    const min = f => act.filter(f).sort((a, b) => a.precio - b.precio)[0];
    const l = [
      ['la moto', p => p.cat === 'moto'],
      ['el triciclo', p => p.cat === 'triciclo'],
      ['el kit solar completo', p => p.cat === 'kit' && esKitCompleto(p)]
    ].map(([n, f]) => { const p = min(f); return p ? `- ${n} más barato/a es ${p.nombre}: $${p.precio}` : ''; })
      .filter(Boolean);
    return l.join('\n');
  }
  function financierasTexto(fin) {
    // Solo nombres y días de uso. El fee es interno.
    return (fin || []).map(f => `- ${f.n} (${f.dias || 'consultar'})`).join('\n');
  }

  /* ---------- Historial de la charla para el prompt ---------- */
  function historialTexto(cliente, limite) {
    const ms = (cliente && cliente.mensajes) || [];
    return ms.slice(-(limite || 20))
      .map(m => (m.de === 'cliente' ? 'CLIENTE: ' : 'VOS: ') + String(m.texto || '').replace(/\n/g, ' '))
      .join('\n') || '(todavía no hablaron)';
  }

  function ejemplosTexto(cfg) {
    return (cfg.ejemplos || []).map((e, i) =>
      `Ejemplo ${i + 1}:\nCLIENTE: ${e.cliente}\nVOS: ${e.yo}`).join('\n\n');
  }

  /* ---------- El prompt ---------- */
  function armarPrompt(cliente, texto, cfg, inv, fin) {
    const est = estadoFiltro(cliente);
    const d = (cliente.asis && cliente.asis.datos) || {};
    const anuncio = cliente.adReferral && cliente.adReferral.titulo
      ? `Escribió desde el anuncio: "${cliente.adReferral.titulo}". Ya sabés por dónde vino, no le preguntes de dónde nos conoció.`
      : '';
    const nDatos = CAMPOS.map(f => `- ${f.label}: ${d[f.id] ? d[f.id] : '(FALTA)'}`).join('\n');

    return `Sos ${cfg.agente}, vendedor de ${cfg.negocio}, una concesionaria en Miami que vende motos, triciclos y kits solares. Muchos clientes compran acá para enviarle el producto a un familiar en Cuba.

Estás contestando por WhatsApp a una persona que escribió desde un anuncio de Facebook. ${anuncio}

TU OBJETIVO
Averiguar en pocos mensajes estos 5 datos y después pasarle el cliente a un vendedor para que lo llame por teléfono. NO tenés que cerrar la venta por chat.

${nDatos}

Ya juntaste ${est.n} de 5. Preguntá por lo que FALTA, de a UNA cosa por mensaje. Lo que ya sabés no lo vuelvas a preguntar.

CÓMO CERRÁS
Con ${MIN_CAMPOS} de los 5 datos ya alcanza. Si con este mensaje que te acaba de mandar llegás a ${MIN_CAMPOS} o más, NO preguntes nada más: despedite confirmando la llamada, corto y natural. Algo del estilo de "${cfg.cierre || 'Dale, te llamo y lo cerramos.'}". El que llama es un vendedor de verdad, así que no prometas nada más que la llamada.

CÓMO ESCRIBÍS (esto es lo más importante)
${cfg.estilo}
- Mensajes cortos, de una o dos líneas. Como escribe una persona por WhatsApp.
- Podés mandar como máximo 2 mensajes seguidos. Normalmente uno solo.
- PROHIBIDO: listas con viñetas, numeraciones, negritas, títulos, "¿En qué puedo ayudarte?", "Estoy para ayudarte", "Excelente elección", "Perfecto!" al inicio de cada mensaje.
- PROHIBIDO decir que sos un asistente, un bot o una IA. Tampoco lo niegues: si te lo preguntan devolvé handoff en true y no contestes nada.
- Una sola pregunta por mensaje. No hagas un interrogatorio.
- No repitas la última cosa que dijiste con otras palabras.
- Si te dice que no le interesa o que solo estaba mirando: insistí UNA sola vez, corto. Si te dice que no de nuevo, despedite bien y devolvé "frio": true.

CATÁLOGO: LO MÁS BARATO DE CADA CATEGORÍA (usá esto si te preguntan por el más barato, NO busques a ojo en la lista)
${masBaratosTexto(inv)}

QUÉ PODÉS DECIR Y QUÉ NO
- Precios: SOLO los del catálogo de abajo, exactos. Si te piden algo que no está, decí que lo confirmás en la llamada.
- NUNCA inventes descuentos, promociones, plazos de entrega, cuotas ni montos de financiación.
- NUNCA hables de comisiones, fees ni de cuánto gana el negocio.
- NUNCA prometas que la financiación va a salir aprobada. Se chequea en la llamada.
- Del envío a Cuba: podés decir que se maneja, los detalles se ven en la llamada.

CATÁLOGO REAL (precios cash, en dólares)
${catalogoTexto(inv)}

FINANCIERAS CON LAS QUE TRABAJAMOS (podés nombrarlas, sin dar detalles de costos)
${financierasTexto(fin)}

CONVERSACIÓN HASTA AHORA
${historialTexto(cliente, 20)}

ÚLTIMO MENSAJE DEL CLIENTE
"${String(texto || '').slice(0, 1500)}"

ASÍ ESCRIBE ${cfg.agente.toUpperCase()} (copiá este tono, no el contenido)
${ejemplosTexto(cfg)}

Hoy es ${hoy()}, son las ${ahora()} en Miami.

Devolvé SOLO este JSON, sin nada más:
{"mensajes":["texto del mensaje 1","texto del mensaje 2 (opcional, o borrá este)"],
 "datos":{"producto":"","destino":"","pago":"","urgencia":"","contacto":""},
 "handoff":false,
 "motivo":"",
 "descartar":false,
 "frio":false,
 "resumen":""}

Reglas del JSON:
- "mensajes": 1 o 2 mensajes. Si handoff es true, dejalo vacío ([]).
- "frio": true si te dijo dos veces que no le interesa, que está caro y se va, o que solo estaba mirando. En ese caso mandá un mensaje corto de despedida amable y nada más.
- "datos": copiá TODO lo que ya sabías y agregá lo nuevo que sacaste de este mensaje. Lo que no sepas, string vacío. NO ADIVINES: si el cliente no dijo si es para Miami o para Cuba, dejá "destino" vacío aunque te parezca obvio. Lo mismo con el resto. Para "producto" poné el modelo exacto del catálogo si lo mencionó. Para "destino" poné "Miami" o "Cuba". Para "pago" poné "Cash" o "Financiado". Para "contacto" poné el nombre y el horario que dio.
- "handoff": true SOLO si te preguntan si sos un bot, si piden hablar con una persona, si están enojados, o si preguntan algo que no podés contestar sin inventar. Tener los datos completos NO es motivo de handoff: en ese caso mandás el mensaje de despedida con handoff en false y listo.
- "descartar": true si claramente no es un cliente (spam, se equivocó de número, ofrece servicios).
- "resumen": una línea con lo que hay que saber antes de llamarlo. Ejemplo: "Quiere una Titan 250 para mandar a Cuba, financiado, llamar después de las 6".`;
  }

  /* ---------- Respuesta ---------- */
  async function responder(opts) {
    const cliente = opts.cliente || {};
    const texto = opts.texto || '';
    const cfg = opts.cfg || cargarCfg();
    const inv = opts.inventario || [];
    const fin = opts.financieras || [];

    cliente.asis = cliente.asis || { datos: {}, msgs: 0, estado: 'activo' };
    const asis = cliente.asis;

    // --- Salidas de emergencia, antes de gastar una llamada a la IA ---
    if (esPreguntaBot(texto))
      return corte(cliente, 'Preguntó si es un bot', cfg, true);
    if (pideHumano(texto))
      return corte(cliente, 'Pidió hablar con una persona', cfg, true);
    if (esNoTexto(texto))
      return corte(cliente, 'Mandó un audio o una foto', cfg, true);
    if (asis.msgs >= (cfg.maxMensajes || 12))
      return corte(cliente, 'La charla se hizo larga (' + asis.msgs + ' mensajes)', cfg, true);

    // --- Cerebro ---
    // Se intenta dos veces: la IA de vez en cuando devuelve el JSON envuelto
    // en ``` o con texto alrededor, y un segundo tiro suele salir limpio.
    const prompt = armarPrompt(cliente, texto, cfg, inv, fin);
    const tIA = Date.now();
    let r = null, a = null;
    for (let intento = 0; intento < 2 && !a; intento++) {
      r = await geminiChain([{ text: prompt }]);
      if (!r || !r.ok) continue;
      a = parseJSON(r.text);
    }
    const msIA = Date.now() - tIA;
    if (!r || !r.ok)
      return corte(cliente, 'La IA no respondió (' + ((r && r.reason) || 'sin conexión') + ')', cfg, true);
    if (!a)
      return corte(cliente, 'La IA devolvió algo que no se entiende', cfg, true);

    // Guardar lo que aprendió (sin pisar con vacío lo que ya sabía)
    const nuevos = a.datos || {};
    CAMPOS.forEach(f => {
      const v = String(nuevos[f.id] || '').trim();
      if (v) asis.datos[f.id] = v;
    });
    if (a.resumen) asis.resumen = String(a.resumen).slice(0, 300);

    if (a.descartar) {
      asis.estado = 'descartado';
      return { ok: true, mensajes: [], datos: asis.datos, listo: false, handoff: true, descartar: true, motivo: 'No parece un cliente real', modelo: r.model };
    }
    if (a.handoff) {
      // Si ya juntó todo, el modelo a veces marca handoff con motivo "datos
      // completos". Eso no es que se trabó: es un lead calificado.
      const est0 = estadoFiltro(cliente);
      if (est0.listo) {
        asis.estado = 'listo';
        return { ok: true, mensajes: [], datos: asis.datos, listo: true, filtro: est0, handoff: false, motivo: '', resumen: asis.resumen, modelo: r.model, msIA };
      }
      asis.estado = 'handoff';
      return { ok: true, mensajes: [], datos: asis.datos, listo: false, filtro: est0, handoff: true, motivo: a.motivo || 'El asistente prefirió pasarlo a un humano', resumen: asis.resumen, modelo: r.model, msIA };
    }

    let mensajes = (Array.isArray(a.mensajes) ? a.mensajes : [a.mensajes])
      .map(m => String(m || '').trim()).filter(Boolean).slice(0, 2);
    mensajes = mensajes.map(limpiarMensaje).filter(Boolean);
    if (!mensajes.length)
      return corte(cliente, 'La IA no escribió ninguna respuesta', cfg, true);

    asis.msgs = (asis.msgs || 0) + mensajes.length;

    // ¿Ya está listo para la llamada?
    const est = estadoFiltro(cliente);
    if (a.frio) asis.estado = 'frio';
    else if (est.listo && asis.estado === 'activo') asis.estado = 'listo';

    return {
      ok: true, mensajes, datos: asis.datos, resumen: asis.resumen,
      listo: est.listo && !a.frio, frio: !!a.frio, filtro: est,
      handoff: false, motivo: '',
      delays: calcularDelays(mensajes, cfg, msIA), modelo: r.model, msIA
    };
  }

  /* Corta la charla y se la pasa a un humano. */
  function corte(cliente, motivo, cfg, marcar) {
    if (marcar && cliente.asis) cliente.asis.estado = 'handoff';
    return {
      ok: true, mensajes: [], handoff: true, motivo,
      datos: (cliente.asis && cliente.asis.datos) || {},
      resumen: (cliente.asis && cliente.asis.resumen) || '',
      filtro: estadoFiltro(cliente), listo: false
    };
  }

  /* Lee el JSON de la IA aunque venga sucio: entre ```json, con texto antes
     o después, o con el objeto en el medio de una explicación. */
  function parseJSON(txt) {
    let s = String(txt || '').trim();
    if (!s) return null;
    try { return JSON.parse(s); } catch (e) { }
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(s); } catch (e) { }
    const i = s.indexOf('{'), f = s.lastIndexOf('}');
    if (i >= 0 && f > i) { try { return JSON.parse(s.slice(i, f + 1)); } catch (e) { } }
    return null;
  }

  /* Saca lo que delata a una IA aunque el prompt lo prohíba. */
  function limpiarMensaje(t) {
    let s = String(t || '');
    s = s.replace(/\*\*(.+?)\*\*/g, '$1');                    // negritas markdown
    s = s.replace(/^\s*[-•*]\s+/gm, '');                      // viñetas
    s = s.replace(/^\s*\d+[.)]\s+/gm, '');                    // numeraciones
    s = s.replace(/^(¡?Hola!?,?\s*)?(soy|te habla) (el |un )?(asistente|bot|chatbot)[^.\n]*\.?\s*/i, '');
    s = s.replace(/¿En qué (más )?(puedo|te puedo) ayudar(te)?\??/gi, '');
    s = s.replace(/Estoy (aquí|acá) para ayudarte\.?/gi, '');
    s = s.replace(/\n{3,}/g, '\n\n').trim();
    return s.slice(0, 900);
  }

  /* Tiempos humanos: una espera antes del primer mensaje y una pausa corta
     entre el primero y el segundo, proporcional a lo que escribe.
     El objetivo es el tiempo TOTAL desde que el cliente escribió, así que le
     descontamos lo que ya tardó la IA (que a veces se toma 20 o 30 segundos).
     Si la IA tardó más que el objetivo, contesta casi enseguida. */
  function calcularDelays(mensajes, cfg, msIA) {
    const min = Number(cfg.delayMin || 10), max = Number(cfg.delayMax || 45);
    const objetivo = Math.round((min + Math.random() * Math.max(1, max - min)) * 1000);
    const base = Math.max(2500, objetivo - (Number(msIA) || 0));
    return mensajes.map((m, i) => i === 0 ? base : Math.min(9000, 1500 + String(m).length * 45));
  }

  /* ¿Estamos dentro del horario en que contesta? */
  function enHorario(cfg, ahoraHHMM) {
    const h = ahoraHHMM || ahora();
    const d = (cfg.horaDesde || '00:00'), f = (cfg.horaHasta || '23:59');
    return h >= d && h <= f;
  }

  /* Texto que le llega a Octa al celu cuando el lead queda listo. */
  function avisoLead(cliente, res) {
    const d = res.datos || {};
    const partes = [d.producto, d.destino, d.pago, d.urgencia].filter(Boolean).join(' · ');
    return {
      title: res.listo ? '✅ Lead listo para llamar' : '🙋 Te necesitan en un chat',
      body: (cliente.nombre || cliente.whatsapp || 'Lead') + (partes ? ' — ' + partes : '') +
        (res.motivo ? ' (' + res.motivo + ')' : '')
    };
  }

  return {
    CAMPOS, MIN_CAMPOS, DEFAULT_CFG,
    cargarCfg, guardarCfg, responder, estadoFiltro,
    enHorario, avisoLead, calcularDelays, limpiarMensaje,
    esPreguntaBot, pideHumano, armarPrompt, catalogoTexto
  };
}

module.exports = crearAsistente;
