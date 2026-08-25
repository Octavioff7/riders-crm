/* ============================================================
   Riders Miami CRM — Asistente de WhatsApp para leads de anuncios
   ------------------------------------------------------------
   Contesta a la gente que escribe desde los anuncios de Facebook,
   habla con el tono de Octa (se aprende de sus chats reales), junta
   los datos que hacen falta para calificar el lead, y después se lo
   pasa a un humano para la llamada.

   REGLA CENTRAL: el asistente NO habla de precios. El cliente que ya
   consultó en otros lados se agarra del número y compara nada más;
   el precio lo maneja Octa por teléfono, donde puede mejorar
   cualquier presupuesto que el cliente le muestre. Por eso al modelo
   ni siquiera se le pasan los precios del catálogo: no puede filtrar
   lo que nunca vio.

   Este módulo NO manda nada por su cuenta: devuelve los mensajes ya
   escritos y quien lo llama decide si los envía por la API de
   WhatsApp o si es una simulación de prueba desde el CRM.
   ============================================================ */

/* Los datos del filtro. Los `req` son los que hacen falta para pasarle
   el lead a Octa; "presupuesto" es un extra muy valioso (un cliente con
   cotización de otro lado es el más fácil de cerrar) pero no bloquea. */
const CAMPOS = [
  { id: 'producto', label: 'Qué producto le interesa', req: true },
  { id: 'destino', label: 'Miami o envío a Cuba', req: true },
  { id: 'pago', label: 'Cash o financiado', req: true },
  { id: 'urgencia', label: 'Para cuándo lo quiere', req: true },
  { id: 'contacto', label: 'Nombre y horario para llamarlo', req: true },
  { id: 'presupuesto', label: 'Presupuesto de otro lado', req: false }
];
const MIN_CAMPOS = 4; // con 4 de los 5 obligatorios ya se le pasa a Octa

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

  /* --- Estrategia de venta --- */
  sinPrecios: true,           // el bot nunca dice un precio; el precio es de la llamada
  maxPedidosPrecio: 3,        // si insiste tantas veces por el precio, se lo pasa a Octa
  instagram: '',              // ej: @ridersmiamimotorcycles — vacío = no lo menciona
  maps: '',                   // link de Google Maps — vacío = no lo menciona
  reviews: '',                // ej: "casi 700 reseñas y 4.9 estrellas en Google"
  mejoraPresupuesto: true,    // ofrecer mejorar cualquier cotización que traiga

  estilo: [
    'Escribí en español de Miami, como se le habla a un cliente cubano.',
    'Usá "tú" SIEMPRE (tienes, quieres, para ti). Nunca "usted" y nunca "vos".',
    'Mensajes de una o dos líneas. Cortos.',
    'Sin emojis, o como mucho uno cada varios mensajes.',
    'Empezá directo, sin "Hola, ¿cómo estás? Espero que te encuentres bien".'
  ].join('\n'),
  ejemplos: [
    { cliente: 'Hola, precio de la moto?', yo: 'Hola! Cuál te gustó, la de la foto del anuncio?' },
    { cliente: 'si esa. cuanto sale?', yo: 'El precio te lo paso en una llamada de dos minutos, porque cambia según cómo la pagues.\nEs para ti aquí o para mandarla a Cuba?' },
    { cliente: 'para cuba. pero dime el precio', yo: 'Te digo algo mejor: si ya tienes precio de otro lugar, mándame la foto y te lo mejoro.\nA qué hora te viene bien que te llame?' },
    { cliente: 'y ustedes son serios?', yo: 'Mira nuestro Google, tenemos casi 700 reseñas.\nEstamos en el local hace años, puedes pasar cuando quieras.' }
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
  const REQ = CAMPOS.filter(f => f.req);
  function estadoFiltro(cliente) {
    const d = (cliente && cliente.asis && cliente.asis.datos) || {};
    const completos = REQ.filter(f => String(d[f.id] || '').trim()).map(f => f.id);
    const faltan = REQ.filter(f => !completos.includes(f.id));
    return {
      completos, faltan,
      n: completos.length, total: REQ.length,
      pct: Math.round(completos.length / REQ.length * 100),
      listo: completos.length >= MIN_CAMPOS
    };
  }

  /* ---------- Detectores que NO le dejamos a la IA ----------
     Estas son las salidas de emergencia. Van por regex porque tienen
     que dispararse siempre, aunque el modelo se equivoque. */
  const RE_BOT = /\b(sos|eres|soy hablando con|est(o|oy hablando con)|es)\s*(un[ao]?\s*)?(bot|robot|m[aá]quina|maquina|ia|inteligencia artificial|chatgpt|gpt|contestador autom[aá]tico)\b|\bes autom[aá]tico\b|\bes un[ao]? (bot|ia|m[aá]quina)\b|\bhablo con (una )?(persona|humano|alguien real)\b|\bhay alguien (real|ah[ií])\b/i;
  // Desconfianza normal ("hay mucha estafa", "son de fiar?") NO es un cliente
  // enojado: es el momento exacto de mostrarle las reseñas de Google. Se chequea
  // ANTES que el enojo porque comparten las mismas palabras.
  const RE_DESCONFIA = /\b(hay|tanta|tanto|much[oa]s?)\s+(much[oa]s?\s+)?(estafa|estafador|ladron|ladr[oó]n)|no quiero que me estafen|no me vayan? a estafar|\bson (de )?fiar\b|\bson serios\b|\bes seguro\b|\bconfiabl|\bson confiables\b|\bes real (esto|eso)\b/i;
  const RE_ENOJO = /\b(me estafaron|me estafaste|me robaron|esto es una estafa|es una estafa|son unos? (estafador|ladron|ladr[oó]n)|denuncia|abogado|reclamo|devoluci[oó]n|reembolso)\b|\b(que|una) (basura|porquer[ií]a)\b/i;
  // OJO: acá NO va "llamame". Que el cliente pida que lo llamen es justo lo
  // que queremos que pase — no es un pedido de escalar a un humano.
  const RE_HUMANO = /\b(quiero hablar con|pasame con|p[aá]same con|comunicame con|com[uú]nicame con|me atiende|que me atienda)\s*(un|una|el|la)?\s*(persona|humano|vendedor|encargado|due[ñn]o|jefe)\b/i;
  // Pide precio: para contar cuántas veces insiste antes de pasárselo a Octa.
  const RE_PIDE_PRECIO = /\b(precio|precios|cuanto|cu[aá]nto|vale|cuesta|sale|cotizaci[oó]n|presupuesto|barat|costo)\b/i;

  function esPreguntaBot(t) { return RE_BOT.test(String(t || '')); }
  function pideHumano(t) {
    const s = String(t || '');
    if (RE_DESCONFIA.test(s)) return false; // eso lo contesta el bot con las reseñas
    return RE_ENOJO.test(s) || RE_HUMANO.test(s);
  }
  function pidePrecio(t) { return RE_PIDE_PRECIO.test(String(t || '')); }
  function esNoTexto(t) { return /^\[(audio|image|imagen|video|document|sticker|location|ubicaci[oó]n|voice)/i.test(String(t || '').trim()); }
  function esImagen(t) { return /^\[(image|imagen|document|photo)/i.test(String(t || '').trim()); }

  /* Red de seguridad: si a pesar de todo el modelo escribe un número que
     parece un precio, ese mensaje no sale. No le pasamos los precios en
     ningún momento, así que un número acá es una invención. */
  const RE_PRECIO_SALIDA = /\$\s*\d|\b\d{3,5}\s*(?:d[oó]lares|dolares|usd|dls|d[oó]lar)\b|\b(?:sale|cuesta|vale|est[aá] en|precio de|ronda|arranca en|desde)\s+(?:los\s+)?\d{3,5}\b/i;
  function tienePrecio(t) { return RE_PRECIO_SALIDA.test(String(t || '')); }

  /* ---------- Catálogo para el prompt ----------
     SIN PRECIOS cuando sinPrecios está activo: el modelo necesita los
     nombres de los modelos para poder conversar ("la Titan 250"), pero
     no tiene por qué conocer los números.
     La categoría "kit" del inventario mezcla kits solares completos con
     paneles, baterías e inversores sueltos, así que se separan. */
  const esKitCompleto = p => /^kit\b/i.test(String(p.nombre || ''));
  function catalogoTexto(inv, cfg) {
    const sinPrecios = !cfg || cfg.sinPrecios !== false;
    const act = (inv || []).filter(p => p && p.activo !== false);
    const linea = p => `- ${p.nombre}${p.motor ? ' (' + p.motor + ')' : ''}` + (sinPrecios ? '' : `: $${p.precio}`);
    const grupo = f => act.filter(f).map(linea).join('\n');
    return [
      'MOTOS:\n' + (grupo(p => p.cat === 'moto') || '(sin stock cargado)'),
      'TRICICLOS:\n' + (grupo(p => p.cat === 'triciclo') || '(sin stock cargado)'),
      'KITS SOLARES COMPLETOS:\n' + (grupo(p => p.cat === 'kit' && esKitCompleto(p)) || '(sin stock cargado)'),
      'EQUIPOS Y REPUESTOS SUELTOS (esto NO es un kit completo, no lo ofrezcas como si lo fuera):\n'
      + (grupo(p => p.cat === 'kit' && !esKitCompleto(p)) || '(nada cargado)')
    ].join('\n\n');
  }

  /* Los argumentos de venta que reemplazan al precio. Solo se le dan al
     modelo los que Octa cargó: si no hay Instagram, no lo puede inventar. */
  function argumentosTexto(cfg) {
    const l = [];
    if (cfg.reviews) l.push(`- Reseñas: ${cfg.reviews}. Es tu argumento más fuerte, usalo cuando duden de si somos serios.`);
    if (cfg.maps) l.push(`- Google Maps del local (mandá el link tal cual): ${cfg.maps}`);
    if (cfg.instagram) l.push(`- Instagram (mandalo tal cual): ${cfg.instagram}`);
    if (cfg.mejoraPresupuesto) l.push('- Si ya tiene precio de otro lugar: pedile que te mande una FOTO del presupuesto, que se lo mejoramos. Es la mejor forma de sacarlo del "solo estoy preguntando".');
    if (!l.length) return '(todavía no hay material cargado: no menciones Instagram, Google Maps ni reseñas, no inventes links ni números de reseñas)';
    return l.join('\n');
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
    const vecesPrecio = (cliente.asis && cliente.asis.precioPedido) || 0;
    const anuncio = cliente.adReferral && cliente.adReferral.titulo
      ? `Escribió desde el anuncio: "${cliente.adReferral.titulo}". Ya sabés por dónde vino, no le preguntes de dónde nos conoció.`
      : '';
    const nDatos = CAMPOS.map(f => `- ${f.label}${f.req ? '' : ' (opcional pero muy valioso)'}: ${d[f.id] ? d[f.id] : '(FALTA)'}`).join('\n');

    const bloquePrecio = cfg.sinPrecios === false ? '' : `
LO MÁS IMPORTANTE DE TODO: NO HABLÁS DE PRECIOS
Nunca, bajo ninguna circunstancia, digas un precio, un rango, una cuota, un monto de entrada, ni "desde tanto". No tenés los precios y no los vas a tener.
El motivo real es este: el cliente que escribe por un anuncio casi siempre ya preguntó en otros lugares. Si le tirás un número, deja de escuchar y se pone a comparar números. El precio lo da ${cfg.agente} por teléfono, donde puede escuchar qué necesita y mejorarle lo que le hayan ofrecido.

Cuando te pregunten el precio (te lo van a preguntar enseguida), no lo esquives con vueltas: dale un motivo concreto y seguí. Cosas ciertas que podés decir:
- Que el precio final cambia según cómo lo pague (cash, tarjeta o financiado) y según si va para Cuba, así que se lo pasás bien en la llamada.
- Que si ya tiene un precio de otro lugar, te mande una foto del presupuesto y se lo mejoran.
- Que la llamada son dos minutos.
Ya te preguntó el precio ${vecesPrecio} vez/veces. Si te lo pregunta más de ${cfg.maxPedidosPrecio || 3} veces, ya no lo esquives más: poné handoff en true con el motivo "insiste con el precio".
No repitas la misma excusa dos veces seguidas, cambiá el ángulo.
`;

    return `Sos ${cfg.agente}, vendedor de ${cfg.negocio}, una concesionaria en Miami que vende motos, triciclos y kits solares. Muchos clientes compran acá para enviarle el producto a un familiar en Cuba.

Estás contestando por WhatsApp a una persona que escribió desde un anuncio de Facebook. ${anuncio}

TU OBJETIVO
Que esta persona acepte una llamada telefónica. En el camino averiguás lo que puedas de esta lista. NO cerrás la venta por chat y NO das precios.

${nDatos}

Ya juntaste ${est.n} de ${est.total} datos obligatorios. Preguntá por lo que FALTA, de a UNA cosa por mensaje. Lo que ya sabés no lo vuelvas a preguntar.
${bloquePrecio}
CÓMO CERRÁS
Con ${MIN_CAMPOS} de los ${est.total} datos obligatorios ya alcanza. Si con este mensaje que te acaba de mandar llegás a ${MIN_CAMPOS} o más, NO preguntes nada más: despedite confirmando la llamada, corto y natural. Algo del estilo de "${cfg.cierre || 'Dale, te llamo y lo cerramos.'}".

TUS ARGUMENTOS (esto es lo que usás en lugar del precio)
${argumentosTexto(cfg)}

CÓMO ESCRIBÍS (esto es lo más importante después de lo del precio)
${cfg.estilo}
- Mensajes cortos, de una o dos líneas. Como escribe una persona por WhatsApp.
- Podés mandar como máximo 2 mensajes seguidos. Normalmente uno solo.
- PROHIBIDO: listas con viñetas, numeraciones, negritas, títulos, "¿En qué puedo ayudarte?", "Estoy para ayudarte", "Excelente elección", "Perfecto!" al inicio de cada mensaje.
- PROHIBIDO decir que sos un asistente, un bot o una IA. Tampoco lo niegues: si te lo preguntan devolvé handoff en true y no contestes nada.
- Una sola pregunta por mensaje. No hagas un interrogatorio.
- No repitas la última cosa que dijiste con otras palabras.
- Si te dice que no le interesa o que solo estaba mirando: insistí UNA sola vez, corto. Si te dice que no de nuevo, despedite bien y devolvé "frio": true.

QUÉ MÁS NO PODÉS HACER
- NUNCA inventes descuentos, promociones, plazos de entrega, cuotas ni montos de financiación.
- NUNCA hables de comisiones, fees ni de cuánto gana el negocio.
- NUNCA prometas que la financiación va a salir aprobada. Se chequea en la llamada.
- NUNCA inventes un link, un usuario de Instagram ni una cantidad de reseñas: usá solo los de la lista de arriba.
- Del envío a Cuba: podés decir que se maneja, los detalles se ven en la llamada.

MODELOS QUE TENEMOS (para poder conversar; los precios NO están acá a propósito)
${catalogoTexto(inv, cfg)}

FINANCIERAS CON LAS QUE TRABAJAMOS (podés decir que financiamos y nombrarlas, sin dar ningún costo)
${(fin || []).map(f => '- ' + f.n).join('\n')}

CONVERSACIÓN HASTA AHORA
${historialTexto(cliente, 20)}

ÚLTIMO MENSAJE DEL CLIENTE
"${String(texto || '').slice(0, 1500)}"

ASÍ ESCRIBE ${cfg.agente.toUpperCase()} (copiá este tono, no el contenido)
${ejemplosTexto(cfg)}

Hoy es ${hoy()}, son las ${ahora()} en Miami.

Devolvé SOLO este JSON, sin nada más:
{"mensajes":["texto del mensaje 1","texto del mensaje 2 (opcional, o borrá este)"],
 "datos":{"producto":"","destino":"","pago":"","urgencia":"","contacto":"","presupuesto":""},
 "handoff":false,
 "motivo":"",
 "descartar":false,
 "frio":false,
 "resumen":""}

Reglas del JSON:
- "mensajes": 1 o 2 mensajes. Si handoff es true, dejalo vacío ([]).
- "datos": copiá TODO lo que ya sabías y agregá lo nuevo que sacaste de este mensaje. Lo que no sepas, string vacío. NO ADIVINES: si el cliente no dijo si es para Miami o para Cuba, dejá "destino" vacío aunque te parezca obvio. Lo mismo con el resto. Para "producto" poné el modelo exacto de la lista si lo mencionó. Para "destino" poné "Miami" o "Cuba". Para "pago" poné "Cash" o "Financiado". Para "contacto" poné el nombre y el horario que dio. Para "presupuesto" poné lo que haya contado de precios que le dieron en otro lado.
- "handoff": true SOLO si te preguntan si sos un bot, si piden hablar con una persona, si están enojados, si insisten demasiado con el precio, o si preguntan algo que no podés contestar sin inventar. Tener los datos completos NO es motivo de handoff: en ese caso mandás el mensaje de despedida con handoff en false.
- "frio": true si te dijo dos veces que no le interesa o que solo estaba mirando. En ese caso mandá un mensaje corto de despedida amable y nada más.
- "descartar": true si claramente no es un cliente (spam, se equivocó de número, ofrece servicios).
- "resumen": una línea con lo que hay que saber antes de llamarlo. Si tiene un presupuesto de otro lado, ponelo SIEMPRE. Ejemplo: "Quiere una Titan 250 para Cuba, financiado, le ofrecieron 4800 en otro lugar, llamar después de las 6".`;
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
    if (pidePrecio(texto)) asis.precioPedido = (asis.precioPedido || 0) + 1;

    // --- Salidas de emergencia, antes de gastar una llamada a la IA ---
    if (esPreguntaBot(texto))
      return corte(cliente, 'Preguntó si es un bot', cfg, true);
    if (pideHumano(texto))
      return corte(cliente, RE_ENOJO.test(texto) ? '⚠️ Cliente enojado — entrá vos' : 'Pidió hablar con una persona', cfg, true, RE_ENOJO.test(texto));
    if (esImagen(texto) && asis.pidioPresupuesto)
      return corte(cliente, '📸 Mandó el presupuesto de la competencia — entrá a verlo', cfg, true, true);
    if (esNoTexto(texto))
      return corte(cliente, 'Mandó un audio o una foto', cfg, true);
    if (asis.msgs >= (cfg.maxMensajes || 12))
      return corte(cliente, 'La charla se hizo larga (' + asis.msgs + ' mensajes)', cfg, true);
    if (cfg.sinPrecios !== false && asis.precioPedido > (cfg.maxPedidosPrecio || 3))
      return corte(cliente, 'Insiste con el precio — llamalo vos', cfg, true, true);

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

    // Red de seguridad del precio: si se le escapó un número, ese mensaje no sale.
    let fugaPrecio = false;
    if (cfg.sinPrecios !== false) {
      const antes = mensajes.length;
      mensajes = mensajes.filter(m => !tienePrecio(m));
      fugaPrecio = mensajes.length < antes;
      if (fugaPrecio && !mensajes.length)
        return corte(cliente, 'La IA quiso dar un precio — mejor llamalo vos', cfg, true, true);
    }
    if (!mensajes.length)
      return corte(cliente, 'La IA no escribió ninguna respuesta', cfg, true);

    asis.msgs = (asis.msgs || 0) + mensajes.length;
    // ¿Le pidió el presupuesto de la competencia? Si después manda una foto,
    // sabemos que es la cotización y se la pasamos a Octa marcada como caliente.
    if (/present?upuesto|cotizaci[oó]n|foto del precio|lo que te ofrecieron|mejorar?telo/i.test(mensajes.join(' ')))
      asis.pidioPresupuesto = true;

    const est = estadoFiltro(cliente);
    if (a.frio) asis.estado = 'frio';
    else if (est.listo && asis.estado === 'activo') asis.estado = 'listo';

    return {
      ok: true, mensajes, datos: asis.datos, resumen: asis.resumen,
      listo: est.listo && !a.frio, frio: !!a.frio, filtro: est,
      handoff: false, motivo: '', fugaPrecio,
      delays: calcularDelays(mensajes, cfg, msIA), modelo: r.model, msIA
    };
  }

  /* Corta la charla y se la pasa a un humano. `caliente` marca los cortes
     que son buena noticia (mandó cotización, insiste con el precio). */
  function corte(cliente, motivo, cfg, marcar, caliente) {
    if (marcar && cliente.asis) cliente.asis.estado = 'handoff';
    return {
      ok: true, mensajes: [], handoff: true, motivo, caliente: !!caliente,
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
      title: res.listo ? '✅ Lead listo para llamar' : (res.caliente ? '🔥 Llamalo ya' : '🙋 Te necesitan en un chat'),
      body: (cliente.nombre || cliente.whatsapp || 'Lead') + (partes ? ' — ' + partes : '') +
        (res.motivo ? ' (' + res.motivo + ')' : '')
    };
  }

  return {
    CAMPOS, MIN_CAMPOS, DEFAULT_CFG,
    cargarCfg, guardarCfg, responder, estadoFiltro,
    enHorario, avisoLead, calcularDelays, limpiarMensaje, parseJSON,
    esPreguntaBot, pideHumano, pidePrecio, tienePrecio, armarPrompt, catalogoTexto
  };
}

module.exports = crearAsistente;
