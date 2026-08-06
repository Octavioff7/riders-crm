/* ============================================================
   Riders Miami CRM — Servidor + Bot de Telegram
   - Sirve el CRM (index.html) y una API para leer/guardar clientes
   - Bot de Telegram: le escribís y actualiza el CRM solo
   - Cerebro: Gemini si hay clave; si no, un parser simple
   ============================================================ */
const http=require('http'),https=require('https'),fs=require('fs'),path=require('path');
const DIR=__dirname;
// DATA_DIR: en local es la carpeta actual; en hosting apunta al disco persistente (env DATA_DIR).
const DATA_DIR=process.env.DATA_DIR||DIR;
try{if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true});}catch(e){}
const CFGPATH=path.join(DATA_DIR,'config.json');
let CFG={};try{CFG=JSON.parse(fs.readFileSync(CFGPATH,'utf8'));}catch(e){try{CFG=JSON.parse(fs.readFileSync(path.join(DIR,'config.json'),'utf8'));}catch(e2){CFG={};}}
// Secretos por variables de entorno (hosting) con fallback a config.json (local).
CFG.telegramToken=process.env.TELEGRAM_TOKEN||CFG.telegramToken;
CFG.geminiKey=process.env.GEMINI_KEY||CFG.geminiKey;
CFG.geminiModel=process.env.GEMINI_MODEL||CFG.geminiModel;
CFG.adminUser=process.env.ADMIN_USER||CFG.adminUser;
CFG.adminPass=process.env.ADMIN_PASS||CFG.adminPass;
if(process.env.ADMIN_CHAT_ID)CFG.allowedChatId=Number(process.env.ADMIN_CHAT_ID);
CFG.port=CFG.port||8790;
const DATA=path.join(DATA_DIR,'clientes.json');

function loadClientes(){try{return JSON.parse(fs.readFileSync(DATA,'utf8'))}catch(e){return []}}
function saveClientes(arr){fs.writeFileSync(DATA,JSON.stringify(arr,null,1))}
function saveCfg(){fs.writeFileSync(CFGPATH,JSON.stringify(CFG,null,2))}

/* ============================================================
   USUARIOS / AUTENTICACIÓN / ROLES  (admin, supervisor, vendedor)
   ============================================================ */
const crypto=require('crypto');
const USERS=path.join(DATA_DIR,'users.json');
function loadUsers(){try{return JSON.parse(fs.readFileSync(USERS,'utf8'))}catch(e){return []}}
function saveUsers(arr){fs.writeFileSync(USERS,JSON.stringify(arr,null,1))}
function uidU(){return 'u'+Math.random().toString(36).slice(2,9)}
function hashPass(pass,salt){salt=salt||crypto.randomBytes(16).toString('hex');const hash=crypto.scryptSync(String(pass),salt,64).toString('hex');return {salt,hash};}
function verifyPass(pass,salt,hash){try{const h=crypto.scryptSync(String(pass),salt,64).toString('hex');const a=Buffer.from(h),b=Buffer.from(hash);return a.length===b.length&&crypto.timingSafeEqual(a,b);}catch(e){return false;}}
const sessions={}; // token -> {userId, exp}
function newSession(userId){const t=crypto.randomBytes(24).toString('hex');sessions[t]={userId,exp:Date.now()+1000*60*60*24*30};return t;}
function userFromReq(req){const h=req.headers['authorization']||'';const t=h.startsWith('Bearer ')?h.slice(7):'';const s=sessions[t];if(!s||s.exp<Date.now())return null;return loadUsers().find(u=>u.id===s.userId&&u.activo!==false)||null;}
function publicUser(u){return u?{id:u.id,nombre:u.nombre,usuario:u.usuario,rol:u.rol,supervisorId:u.supervisorId||null,activo:u.activo!==false}:null;}
function adminUser(){return loadUsers().find(u=>u.rol==='admin');}

// Primer arranque: crear admin (Octa) + asignar clientes existentes.
function ensureSetup(){
  let users=loadUsers();
  if(!users.length){
    const clave=CFG.adminPass||'riders';
    const {salt,hash}=hashPass(clave);
    const admin={id:uidU(),nombre:CFG.adminNombre||'Octa',usuario:(CFG.adminUser||'octa').toLowerCase(),passHash:hash,salt,rol:'admin',supervisorId:null,activo:true,creado:hoy()};
    users=[admin];saveUsers(users);
    const cl=loadClientes();let ch=false;cl.forEach(c=>{if(!c.vendedorId){c.vendedorId=admin.id;ch=true;}});if(ch)saveClientes(cl);
    console.log('\n[setup] Admin creado -> usuario: "'+admin.usuario+'"  clave: "'+clave+'"  (cambiala en Cuentas)\n');
  }
}

/* ---------- Alcance por rol ---------- */
function teamIds(users,sup){return users.filter(u=>u.supervisorId===sup.id).map(u=>u.id).concat(sup.id);}
function canSeeCliente(user,c,users){
  if(user.rol==='admin'||user.rol==='dueno'||user.rol==='supervisor')return true; // dueño y supervisor ven toda la operación (solo lectura)
  if(user.rol==='vendedor')return c.vendedorId===user.id;
  return false;
}
function scopedClientes(user){const cl=loadClientes(),users=loadUsers();return cl.filter(c=>canSeeCliente(user,c,users));}

// Guardado con control de alcance: el front manda su lista (scopeada); el
// servidor solo aplica cambios/creaciones/borrados sobre lo que el usuario puede tocar.
function mergeClientes(user,incoming){
  const users=loadUsers(),current=loadClientes(),byId={};
  current.forEach(c=>byId[c.id]=c);
  const inIds=new Set();
  for(const ic of (Array.isArray(incoming)?incoming:[])){
    if(!ic||!ic.id)continue;inIds.add(ic.id);
    const cur=byId[ic.id];
    if(cur){
      if(!canSeeCliente(user,cur,users))continue; // no tocar ajenos
      let vId=cur.vendedorId;
      if(ic.vendedorId&&ic.vendedorId!==cur.vendedorId){
        if(user.rol==='admin')vId=ic.vendedorId;
        else if(user.rol==='supervisor'&&teamIds(users,user).includes(ic.vendedorId))vId=ic.vendedorId;
      }
      byId[ic.id]=Object.assign({},ic,{vendedorId:vId});
    } else {
      let vId=user.id;
      if(user.rol!=='vendedor'&&ic.vendedorId&&(user.rol==='admin'||teamIds(users,user).includes(ic.vendedorId)))vId=ic.vendedorId;
      byId[ic.id]=Object.assign({},ic,{vendedorId:vId});
    }
  }
  for(const c of current){ if(canSeeCliente(user,c,users)&&!inIds.has(c.id)) delete byId[c.id]; }
  saveClientes(Object.values(byId));
}

/* ---------- Métricas por vendedor ---------- */
function estadoAtrasadoSrv(c){if(!c.proximo)return false;let h=(c.proximoHora&&/^\d{1,2}:\d{2}/.test(c.proximoHora))?c.proximoHora:'23:59';if(h.length===4)h='0'+h;const dt=new Date(c.proximo+'T'+h+':00');return !isNaN(dt)&&dt.getTime()<Date.now()-15*60000;}
function esCalienteSrv(c){return c.etapa!=='vendido'&&c.etapa!=='posventa'&&c.respondioUltimo==='cliente';}
function ultimoLogFecha(c){let f='';(c.log||[]).forEach(l=>{if((l.fecha||'')>f)f=l.fecha;});return f;}
function metricsFor(vendId){
  const cl=loadClientes().filter(c=>c.vendedorId===vendId&&!c.borrado);
  const weekAgo=daysAhead(-7),catorce=daysAhead(-14),mes=hoy().slice(0,7);
  let seguim=0;const acts=[];
  cl.forEach(c=>{(c.log||[]).forEach(l=>{if((l.fecha||'')>=weekAgo)seguim++;acts.push({cliente:c.nombre,fecha:l.fecha,hora:l.hora||'',texto:l.texto});});});
  acts.sort((a,b)=>(b.fecha+(b.hora||'')).localeCompare(a.fecha+(a.hora||'')));
  const esVend=c=>c.etapa==='vendido'||c.etapa==='posventa';
  const vendidosMes=cl.filter(c=>esVend(c)&&(c.vendidoFecha||'').slice(0,7)===mes);
  const facturadoMes=vendidosMes.reduce((s,c)=>s+(Number(c.valor)||0),0);
  const comisionMes=vendidosMes.reduce((s,c)=>s+(Number(c.comision)||0),0);
  const ventasTot=cl.filter(esVend).length;
  const abiertos=cl.filter(c=>!esVend(c));
  const abandonados=abiertos.filter(c=>{const ref=ultimoLogFecha(c)||c.ultimoContacto||c.creado||'';return ref&&ref<catorce;});
  const ultAct=cl.reduce((f,c)=>{const l=ultimoLogFecha(c);return l>f?l:f;},'');
  return {
    total:cl.length,
    ventas:cl.filter(c=>c.etapa==='vendido').length,
    atrasados:cl.filter(estadoAtrasadoSrv).length,
    calientes:cl.filter(esCalienteSrv).length,
    plata:abiertos.reduce((s,c)=>s+(Number(c.valor)||0),0),
    seguimientosSemana:seguim,
    // --- Panel del dueño ---
    ventasMes:vendidosMes.length,
    facturadoMes:facturadoMes,
    comisionMes:comisionMes,
    ticket:vendidosMes.length?Math.round(facturadoMes/vendidosMes.length):0,
    nuevosSemana:cl.filter(c=>(c.creado||'')>=weekAgo).length,
    nuevosMes:cl.filter(c=>(c.creado||'').slice(0,7)===mes).length,
    conversion:cl.length?Math.round(ventasTot/cl.length*100):0,
    abandonados:abandonados.length,
    ultimaActividad:ultAct,
    actividad:acts.slice(0,8)
  };
}
function metricsScoped(user){
  const users=loadUsers();let targets;
  if(user.rol==='admin'||user.rol==='dueno'||user.rol==='supervisor')targets=users.filter(u=>u.activo!==false&&u.rol!=='dueno');
  else targets=[user];
  return targets.map(u=>({user:publicUser(u),metrics:metricsFor(u.id)}));
}

/* ---------- Helpers de fecha / datos ---------- */
function uid(){return 'c'+Math.random().toString(36).slice(2,9)}
function hoy(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function ahora(){const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
const DIAS_SEM=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
function hoyDesc(){return hoy()+' ('+DIAS_SEM[new Date().getDay()]+')'}
function daysAhead(n){const d=new Date();d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)}
function nextWeekday(t){const d=new Date();let a=(t-d.getDay()+7)%7;if(a===0)a=7;d.setDate(d.getDate()+a);return d.toISOString().slice(0,10)}
const ETAPAS={nuevo:'Nuevo',interesado:'Interesado',negociando:'Negociando',vendido:'Vendido',posventa:'Posventa'};

/* ---------- Parser (cerebro simple, sin IA) ---------- */
function findClient(clientes,text){
  const low=text.toLowerCase();
  for(const c of clientes){const full=(c.nombre||'').replace(/\(.*\)/,'').trim().toLowerCase();if(full&&full.length>2&&low.includes(full))return c;}
  for(const c of clientes){const first=(c.nombre||'').replace(/\(.*\)/,'').trim().toLowerCase().split(' ')[0];if(first&&first.length>2&&new RegExp('\\b'+first.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b').test(low))return c;}
  return null;
}
function detProducto(t){t=t.toLowerCase();if(/kit|solar|panel|ecoflow|placa/.test(t))return 'Kit solar';if(/tricicl/.test(t))return 'Triciclo';if(/moto|nafta|scooter/.test(t))return 'Moto';return null;}
function detEtapa(t){t=t.toLowerCase();if(/vend[ií]|vendid|pag[oó]|compr[oó]|cerr[eé]|cerrado/.test(t))return 'vendido';if(/negoci|regate|oferta/.test(t))return 'negociando';if(/interes|pregunt|consult|quiere|averigu/.test(t))return 'interesado';return null;}
function detTipo(t){t=t.toLowerCase();if(/entrevist/.test(t))return 'Entrevista';if(/visit|presencial|reuni/.test(t))return 'Visita presencial';if(/llam/.test(t))return 'Llamada';if(/mensaj|escrib|whats/.test(t))return 'Mensaje';return null;}
function detFecha(t){t=t.toLowerCase();if(/pasado\s+mañana/.test(t))return daysAhead(2);if(/\bmañana\b/.test(t))return daysAhead(1);if(/\bhoy\b/.test(t))return hoy();if(/semana que viene|pr[oó]xima semana|la otra semana/.test(t))return daysAhead(7);const m=t.match(/en\s+(\d+)\s+d[ií]as/);if(m)return daysAhead(+m[1]);const dd=['domingo','lunes','martes','mi[eé]rcoles','jueves','viernes','s[aá]bado'];for(let i=0;i<7;i++)if(new RegExp('\\b'+dd[i]).test(t))return nextWeekday(i);return '';}
function nuevoNombre(t){const m=t.match(/(?:cargá|carga|agregá|agrega|nuevo cliente|nuevo lead|anotá a|anota a|sumá a|suma a|nuevo)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/);return m?m[1].trim():null;}

function parseBrain(clientes,text){
  const acc=[];let c=findClient(clientes,text);
  const crearKW=/(cargá|carga|agregá|agrega|nuevo cliente|nuevo lead|anotá a|anota a|sumá a|suma a)/i.test(text);
  if(!c&&crearKW){const nom=nuevoNombre(text);if(nom){c={id:uid(),nombre:nom,whatsapp:'',producto:detProducto(text)||'Otro',ubicacion:'',etapa:'nuevo',valor:0,proximo:'',proximoTipo:'',creado:hoy(),ultimoContacto:hoy(),respondioUltimo:'cliente',log:[],mensajes:[]};clientes.push(c);acc.push('creé el cliente *'+nom+'*');}}
  if(!c)return {reply:'🤔 No identifiqué de qué cliente hablás. Probá con el nombre — ej: _"Oscar quiere financiar"_. Para uno nuevo: _"cargá a Juan, preguntó por una moto"_.',changed:false};
  const p=detProducto(text);if(p&&p!==c.producto){c.producto=p;acc.push('producto → *'+p+'*');}
  const e=detEtapa(text);if(e&&e!==c.etapa){c.etapa=e;acc.push('etapa → *'+ETAPAS[e]+'*');}
  const f=detFecha(text);if(f){c.proximo=f;const tp=detTipo(text);if(tp)c.proximoTipo=tp;acc.push('agendado → *'+(c.proximoTipo||'seguimiento')+' el '+f+'*');}
  c.log=c.log||[];c.log.push({fecha:hoy(),hora:ahora(),texto:text});
  if(f||e||p)c.ultimoContacto=hoy();
  acc.push('anoté la nota');
  return {reply:'✅ En *'+c.nombre+'*: '+acc.join(', ')+'.',changed:true};
}

/* ---------- Cerebro con Gemini (si hay clave) ---------- */
function geminiCall(prompt){return new Promise((resolve)=>{
  const model=CFG.geminiModel||'gemini-2.0-flash';
  const body=JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.2,responseMimeType:'application/json'}});
  const req=https.request('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+CFG.geminiKey,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{const j=JSON.parse(d);const txt=j.candidates&&j.candidates[0]&&j.candidates[0].content.parts[0].text;resolve(txt||null);}catch(e){resolve(null)}})});
  req.on('error',()=>resolve(null));req.write(body);req.end();
});}

async function geminiBrain(clientes,text){
  const activos=clientes.filter(c=>!c.borrado);
  const lista=activos.map(c=>({nombre:c.nombre,whatsapp:c.whatsapp,producto:c.producto,etapa:c.etapa})).slice(0,80);
  const prompt=`Sos el asistente de un CRM de una concesionaria (motos, kits solares, triciclos) que vende a Cuba.
El dueño (Octa) te escribe en español informal. Puede: agregar una nota/seguimiento a un cliente, crear un cliente nuevo, borrar un cliente, restaurarlo, o actualizar datos. Devolvé SOLO un JSON.

Clientes actuales: ${JSON.stringify(lista)}

Etapas válidas: nuevo, interesado, negociando, vendido, posventa.
Tipos de contacto: Llamada, Entrevista, Visita presencial, Mensaje, Otro.
Tipo de operación: Financiado, Cash.
Hoy es ${hoyDesc()}.

Mensaje del dueño: "${text}"

Identificá al cliente por su NOMBRE o por su NÚMERO de teléfono (el que aparezca).
Devolvé este JSON exacto:
{"accion":"crear"|"actualizar"|"borrar"|"restaurar"|"ninguna","cliente":"<nombre o número que lo identifica, o el nombre del nuevo>","whatsapp":null|"<número tal cual aparezca, o null>","producto":null|"Moto"|"Kit solar"|"Triciclo"|"Otro","operacion":null|"Financiado"|"Cash","etapa":null|"nuevo"|"interesado"|"negociando"|"vendido"|"posventa","valor":null|<numero>,"agendarTipo":null|"Llamada"|"Entrevista"|"Visita presencial"|"Mensaje","agendarFecha":null|"YYYY-MM-DD","nota":null|"<texto de la nota o seguimiento a guardar>","respuesta":"<confirmación corta y amable en español>"}
Reglas: si pide agregar seguimiento o nota, accion "actualizar" con el texto en "nota". Si pide borrar/eliminar, accion "borrar". Si pide recuperar/restaurar, accion "restaurar". Si no identificás al cliente y no es para crear, accion "ninguna" y explicá en "respuesta".`;
  const raw=await geminiCall(prompt);
  if(!raw)return {reply:'⚠️ No pude conectar con la IA (Gemini). Revisá la clave.',changed:false};
  let a;try{a=JSON.parse(raw);}catch(e){return {reply:'🤔 No te entendí bien. Probá de otra forma.',changed:false};}
  const accion=(a.accion||'actualizar').toLowerCase();
  const digits=s=>String(s||'').replace(/\D/g,'');
  const byPhone=(arr,q)=>{const d=digits(q);if(d.length<6)return null;return arr.find(c=>{const cd=digits(c.whatsapp);return cd.length>=6&&(cd.endsWith(d)||d.endsWith(cd));})||null;};
  const findTarget=arr=>{let c=null;if(a.cliente){c=arr.find(x=>(x.nombre||'').toLowerCase()===String(a.cliente).toLowerCase())||findClient(arr,a.cliente);}if(!c)c=byPhone(arr,a.whatsapp||a.cliente);return c;};

  if(accion==='borrar'){
    const c=findTarget(activos);
    if(!c)return {reply:a.respuesta||'No encontré ese cliente para borrar. Decime el nombre o número exacto.',changed:false};
    c.borrado=true;c.borradoFecha=hoy();
    return {reply:'🗑️ Mandé a *'+c.nombre+'* a la papelera. Para recuperarlo: "restaurá a '+c.nombre+'" o desde el CRM.',changed:true};
  }
  if(accion==='restaurar'){
    const c=findTarget(clientes.filter(x=>x.borrado));
    if(!c)return {reply:a.respuesta||'No encontré ese cliente en la papelera.',changed:false};
    c.borrado=false;delete c.borradoFecha;
    return {reply:'♻️ Restauré a *'+c.nombre+'*.',changed:true};
  }

  let c=findTarget(activos);
  if(!c){
    if(accion==='crear'){
      const num=a.whatsapp||(/\d{6,}/.test(String(a.cliente||''))?a.cliente:'');
      c={id:uid(),nombre:a.cliente||num||'Nuevo',whatsapp:num||'',producto:a.producto||'Otro',operacion:a.operacion||'',ubicacion:'',etapa:a.etapa||'nuevo',valor:a.valor||0,proximo:'',proximoTipo:'',creado:hoy(),ultimoContacto:hoy(),respondioUltimo:'cliente',canal:'whatsapp',log:[],mensajes:[]};
      clientes.push(c);
    } else return {reply:a.respuesta||'No identifiqué el cliente. Decime el nombre o el número, o pedime crearlo.',changed:false};
  }
  if(a.whatsapp&&!c.whatsapp)c.whatsapp=a.whatsapp;
  if(a.producto)c.producto=a.producto;
  if(a.operacion)c.operacion=a.operacion;
  if(a.etapa)c.etapa=a.etapa;
  if(a.valor)c.valor=a.valor;
  if(a.agendarFecha){c.proximo=a.agendarFecha;c.proximoTipo=a.agendarTipo||'Seguimiento';}
  c.log=c.log||[];c.log.push({fecha:hoy(),hora:ahora(),texto:a.nota||text});
  c.ultimoContacto=hoy();
  return {reply:'✅ '+(a.respuesta||('Anoté en '+c.nombre)),changed:true};
}

async function procesarMensaje(text){
  const clientes=loadClientes();
  const r=(CFG.geminiKey&&CFG.geminiKey.length>10)?await geminiBrain(clientes,text):parseBrain(clientes,text);
  if(r.changed){const aid=(adminUser()||{}).id;if(aid)clientes.forEach(c=>{if(!c.vendedorId)c.vendedorId=aid;});saveClientes(clientes);}
  return r.reply;
}

/* ---------- Telegram ---------- */
function tg(method,params){return new Promise((resolve)=>{const body=JSON.stringify(params);const req=https.request('https://api.telegram.org/bot'+CFG.telegramToken+'/'+method,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){resolve({ok:false})}})});req.on('error',()=>resolve({ok:false}));req.write(body);req.end();});}
function reply(chatId,text){return tg('sendMessage',{chat_id:chatId,text:text,parse_mode:'Markdown'});}

async function handle(msg){
  const chatId=msg.chat.id;const text=(msg.text||'').trim();if(!text)return;
  if(CFG.allowedChatId===null||CFG.allowedChatId===undefined){
    CFG.allowedChatId=chatId;saveCfg();
    await reply(chatId,'✅ ¡Hola Octa! Soy el *asistente del CRM de Riders Miami*.\nContame en una frase qué pasó con un cliente y lo *anoto solo*.\n\nEjemplos:\n• _Oscar quiere financiar, llamarlo el lunes_\n• _cargá a Juan, preguntó por una moto_\n• _Yosvani ya pagó, marcalo vendido_');
    return;
  }
  if(chatId!==CFG.allowedChatId){await reply(chatId,'🔒 Este bot es privado.');return;}
  if(text==='/start'||text==='/ayuda'||text==='/help'){await reply(chatId,'👋 Mandame qué hacer con un cliente. Ejemplos:\n• _anotá que Oscar quiere financiar_\n• _agendá una llamada con Oscar el viernes_\n• _cargá a Marta, preguntó por un kit solar_\n• _Oscar ya pagó, marcalo vendido_');return;}
  try{const res=await procesarMensaje(text);await reply(chatId,res);}catch(e){await reply(chatId,'⚠️ Ups, algo falló: '+e.message);}
}

let offset=0;
async function poll(){
  try{const upd=await tg('getUpdates',{offset:offset,timeout:30});if(upd&&upd.ok){for(const u of upd.result){offset=u.update_id+1;if(u.message)await handle(u.message);}}}catch(e){}
  setTimeout(poll,500);
}

/* ---------- Servidor HTTP (CRM + API con auth por rol) ---------- */
ensureSetup();
http.createServer((req,res)=>{
  const u=req.url.split('?')[0];
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  const json=(code,obj)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));};
  const readBody=cb=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{cb(b?JSON.parse(b):{})}catch(e){json(400,{error:'json'})}});};

  // Login (sin auth)
  if(u==='/api/login'&&req.method==='POST')return readBody(body=>{
    const us=String(body.usuario||'').trim().toLowerCase();
    const user=loadUsers().find(x=>x.usuario===us);
    if(!user||user.activo===false||!verifyPass(body.pass||'',user.salt,user.passHash))return json(401,{error:'Usuario o clave incorrectos'});
    json(200,{token:newSession(user.id),user:publicUser(user)});
  });

  const apiAuth=u.startsWith('/api/');
  const me=userFromReq(req);
  if(apiAuth&&!me)return json(401,{error:'No autorizado'});

  if(u==='/api/logout'&&req.method==='POST'){const h=req.headers['authorization']||'';const t=h.startsWith('Bearer ')?h.slice(7):'';delete sessions[t];return json(200,{ok:true});}
  if(u==='/api/me'&&req.method==='GET')return json(200,{user:publicUser(me)});

  if(u==='/api/clientes'){
    if(req.method==='GET')return json(200,scopedClientes(me));
    if(req.method==='POST')return readBody(body=>{
      if(me.rol==='supervisor'||me.rol==='dueno')return json(403,{error:'Tu cuenta es de solo lectura'}); // supervisión: ven pero no editan
      mergeClientes(me,body);json(200,{ok:true});
    });
  }

  if(u==='/api/metrics'&&req.method==='GET')return json(200,metricsScoped(me));

  if(u==='/api/users'){
    if(req.method==='GET'){
      const users=loadUsers();let list;
      if(me.rol==='admin'||me.rol==='dueno'||me.rol==='supervisor')list=users;
      else list=[me];
      return json(200,list.map(publicUser));
    }
    if(req.method==='POST')return readBody(body=>{
      if(me.rol!=='admin'&&me.rol!=='supervisor')return json(403,{error:'Sin permiso'});
      const users=loadUsers();const us=String(body.usuario||'').trim().toLowerCase();
      if(!us||!body.nombre||!body.pass)return json(400,{error:'Faltan datos (nombre, usuario y clave)'});
      if(users.some(x=>x.usuario===us))return json(400,{error:'Ese usuario ya existe'});
      let rol=['supervisor','dueno'].includes(body.rol)?body.rol:'vendedor',supervisorId=body.supervisorId||null;
      if(me.rol==='supervisor'){rol='vendedor';supervisorId=me.id;}
      if(rol!=='vendedor')supervisorId=null;
      const {salt,hash}=hashPass(body.pass);
      const nu={id:uidU(),nombre:String(body.nombre).trim(),usuario:us,passHash:hash,salt,rol,supervisorId:rol==='vendedor'?supervisorId:null,activo:true,creado:hoy()};
      users.push(nu);saveUsers(users);json(200,publicUser(nu));
    });
  }
  const mUser=u.match(/^\/api\/users\/([\w-]+)$/);
  if(mUser&&req.method==='PATCH')return readBody(body=>{
    const users=loadUsers();const target=users.find(x=>x.id===mUser[1]);if(!target)return json(404,{error:'No existe'});
    const allowed=me.rol==='admin'||(me.rol==='supervisor'&&target.supervisorId===me.id)||me.id===target.id;
    if(!allowed)return json(403,{error:'Sin permiso'});
    if(typeof body.nombre==='string'&&body.nombre.trim())target.nombre=body.nombre.trim();
    if(body.pass){const {salt,hash}=hashPass(body.pass);target.salt=salt;target.passHash=hash;}
    if(typeof body.activo==='boolean'&&me.rol!=='vendedor'&&target.rol!=='admin')target.activo=body.activo;
    if(me.rol==='admin'){if(body.rol)target.rol=body.rol;if('supervisorId' in body)target.supervisorId=body.supervisorId||null;}
    saveUsers(users);json(200,publicUser(target));
  });
  if(mUser&&req.method==='DELETE'){
    if(me.rol!=='admin')return json(403,{error:'Solo el admin puede eliminar cuentas'});
    const users=loadUsers();const target=users.find(x=>x.id===mUser[1]);
    if(!target)return json(404,{error:'No existe'});
    if(target.id===me.id)return json(400,{error:'No podés eliminar tu propia cuenta'});
    if(target.rol==='admin')return json(400,{error:'No se puede eliminar la cuenta admin'});
    // Reasignar los clientes del eliminado al admin (para no perder datos)
    const cl=loadClientes();let reas=0;cl.forEach(c=>{if(c.vendedorId===target.id){c.vendedorId=me.id;reas++;}});if(reas)saveClientes(cl);
    // Si era supervisor, sus vendedores quedan sin supervisor
    users.forEach(x=>{if(x.supervisorId===target.id)x.supervisorId=null;});
    saveUsers(users.filter(x=>x.id!==target.id));
    return json(200,{ok:true,reasignados:reas});
  }

  if(apiAuth)return json(404,{error:'not found'});

  // Archivos estáticos (no exponer datos sensibles)
  let f=u==='/'?'/index.html':u;const fp=path.join(DIR,decodeURIComponent(f));
  if(!fp.startsWith(DIR)){res.writeHead(403);return res.end('no');}
  if(/(users|clientes|config)\.json$/i.test(fp)){res.writeHead(403);return res.end('no');}
  fs.readFile(fp,(e,d)=>{if(e){res.writeHead(404);res.end('not found')}else{const ext=path.extname(fp);res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'text/javascript':ext==='.json'?'application/json':'text/plain; charset=utf-8');res.end(d)}});
}).listen(process.env.PORT||CFG.port,()=>{
  console.log('CRM en http://localhost:'+CFG.port);
  console.log('Cerebro: '+((CFG.geminiKey&&CFG.geminiKey.length>10)?'Gemini IA':'Parser simple (sin clave de Gemini todavía)'));
  console.log('Bot de Telegram escuchando...');
  poll();
});
