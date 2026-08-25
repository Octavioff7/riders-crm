/* ============================================================
   Riders Miami CRM — Servidor + Bot de Telegram
   - Sirve el CRM (index.html) y una API para leer/guardar clientes
   - Bot de Telegram: le escribís y actualiza el CRM solo
   - Cerebro: Gemini si hay clave; si no, un parser simple
   ============================================================ */
// Zona horaria: el servidor calcula fechas/horas y recordatorios en horario de Miami
// (si no, Render corre en UTC y los avisos salían ~4-5 h antes). Se puede sobreescribir con env TZ.
process.env.TZ=process.env.TZ||'America/New_York';
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
CFG.telegramBotUser=process.env.TELEGRAM_BOT_USER||CFG.telegramBotUser||'RidersCRM_bot';
CFG.port=CFG.port||8790;
const DATA=path.join(DATA_DIR,'clientes.json');
// Documentos de ventas (fotos de licencias / carnets). Se guardan como archivos, no dentro de clientes.json.
const VDOCS=path.join(DATA_DIR,'vdocs');
try{if(!fs.existsSync(VDOCS))fs.mkdirSync(VDOCS,{recursive:true});}catch(e){}
// WhatsApp Cloud API (Meta): token para verificar el webhook y mapeo número→vendedor.
const WA_VERIFY=process.env.WHATSAPP_VERIFY_TOKEN||'riders-crm-verify';
const WAMAPPATH=path.join(DATA_DIR,'wamap.json');
function loadWaMap(){try{return JSON.parse(fs.readFileSync(WAMAPPATH,'utf8'))}catch(e){return {}}}

// ---- Inventario y Financieras: editables por admin, guardados en disco ----
const INVPATH=path.join(DATA_DIR,'inventario.json');
const FINPATH=path.join(DATA_DIR,'financieras.json');
const ORDPATH=path.join(DATA_DIR,'ordenes.json');
const AUDPATH=path.join(DATA_DIR,'auditoria.json');
const SEQPATH=path.join(DATA_DIR,'seq.json');
const DEFAULT_INVENTARIO=[
  {n:1,nombre:'MATIAS',modelo:'MATIAS 250CC',cat:'moto',marca:'VITACCI',motor:'250cc',cc:250,color:'',precio:4600,comision:500,activo:true},
  {n:2,nombre:'TITAN',modelo:'TITAN 250CC',cat:'moto',marca:'VITACCI',motor:'250cc',cc:250,color:'',precio:4500,comision:500,activo:true},
  {n:3,nombre:'GTX',modelo:'GTX 250CC',cat:'moto',marca:'VITACCI',motor:'250cc',cc:250,color:'',precio:4500,comision:500,activo:true},
  {n:4,nombre:'XMT',modelo:'XMT 250CC',cat:'moto',marca:'VITACCI',motor:'250cc',cc:250,color:'',precio:4400,comision:500,activo:true},
  {n:5,nombre:'GP 250cc',modelo:'GP 250CC',cat:'moto',marca:'XMOX',motor:'250cc',cc:250,color:'',precio:4300,comision:500,activo:true},
  {n:6,nombre:'KRATHOS',modelo:'KRATHOS 250CC',cat:'moto',marca:'MOTORSTRECK',motor:'250cc',cc:250,color:'',precio:4000,comision:500,activo:true},
  {n:7,nombre:'RAVEN',modelo:'RAVEN 250CC',cat:'moto',marca:'VITACCI',motor:'250cc',cc:250,color:'',precio:3800,comision:500,activo:true},
  {n:8,nombre:'XMOX RR',modelo:'RR 250',cat:'moto',marca:'XMOX',motor:'250cc',cc:250,color:'',precio:4700,comision:500,activo:true},
  {n:9,nombre:'MAJESTIC',cat:'moto',motor:'250cc',cc:250,color:'',precio:3900,comision:500,activo:true},
  {n:10,nombre:'VHAGAR',modelo:'DX 250CC',cat:'moto',marca:'VHAGAR',motor:'250cc',cc:250,color:'',precio:5000,comision:500,activo:true},
  {n:11,nombre:'DUCASU',modelo:'DUCASSU 250CC',cat:'moto',marca:'DUCASU',motor:'250cc',cc:250,color:'',precio:4000,comision:500,activo:true},
  {n:12,nombre:'KRESTON',modelo:'KRESTON 250CC',cat:'moto',marca:'KRESTON',motor:'250cc',cc:250,color:'',precio:3600,comision:500,activo:true},
  {n:13,nombre:'FALCON',modelo:'FALCON 200CC',cat:'moto',marca:'VITACCI',motor:'200cc',cc:200,color:'',precio:4300,comision:500,activo:true},
  {n:14,nombre:'TANK',modelo:'ZENITH TANK 200CC',cat:'moto',marca:'MZ',motor:'200cc',cc:200,color:'',precio:3300,comision:500,activo:true},
  {n:15,nombre:'TANK SPORT',modelo:'TANK SPORT 200CC',cat:'moto',marca:'VITACCI',motor:'200cc',cc:200,color:'',precio:3500,comision:500,activo:true},
  {n:16,nombre:'INTREPID',modelo:'INTREPID 200CC',cat:'moto',marca:'VITACCI',motor:'200cc',cc:200,color:'',precio:3600,comision:500,activo:true},
  {n:17,nombre:'SUPRA',modelo:'SUPRA 200CC',cat:'moto',marca:'ITALICA',motor:'200cc',cc:200,color:'',precio:4400,comision:500,activo:true},
  {n:18,nombre:'EAGLE',modelo:'EAGLE 200CC',cat:'moto',marca:'VITACCI',motor:'200cc',cc:200,color:'',precio:3500,comision:500,activo:true},
  {n:19,nombre:'SUZUKI 200cc',cat:'moto',motor:'200cc',cc:200,color:'',precio:4100,comision:500,activo:true},
  {n:20,nombre:'CHP',modelo:'CHP 200CC',cat:'moto',marca:'MZ',motor:'200cc',cc:200,color:'',precio:3500,comision:500,activo:true},
  {n:21,nombre:'MISAKI',modelo:'GN 150',cat:'moto',marca:'MISAKI',motor:'150cc',cc:150,color:'',precio:2900,comision:500,activo:true},
  {n:22,nombre:'FOCUS',modelo:'FOCUS 150CC',cat:'moto',marca:'VITACCI',motor:'150cc',cc:150,color:'',precio:3200,comision:500,activo:true},
  {n:23,nombre:'SUZUKI GN 125',modelo:'GN 125F',cat:'moto',marca:'SUZUKI',motor:'125cc',cc:125,color:'',precio:3600,comision:500,activo:true},
  {n:24,nombre:'UNISON AX100',modelo:'UNISON AX100',cat:'moto',marca:'UNISON',motor:'100cc',cc:100,color:'',precio:2700,comision:500,activo:true},
  {n:25,nombre:'TANK ELECTRICA',modelo:'TANK ELECTRICA',cat:'moto',marca:'RIDERS',motor:'Eléctrica',color:'',precio:3200,comision:500,activo:true},
  {n:26,nombre:'TANK SPORT ELECTRICA',cat:'moto',motor:'Eléctrica',color:'',precio:3200,comision:500,activo:true},
  {n:27,nombre:'FOCUS ELECTRICA',cat:'moto',motor:'Eléctrica',color:'',precio:3200,comision:500,activo:true},
  {n:28,nombre:'GRILLO',modelo:'BICI MOTO GRILLO',cat:'moto',marca:'MZ',motor:'Eléctrica',color:'',precio:2300,comision:300,activo:true},
  {n:29,nombre:'MASTERSONIC',modelo:'MASTERSONIC',cat:'moto',marca:'MASTERSONIC',motor:'Eléctrica',color:'',precio:1600,comision:300,activo:true},
  {n:30,nombre:'MASTERSONIC 2.0',cat:'moto',motor:'Eléctrica',color:'',precio:2300,comision:300,activo:true},
  {n:31,nombre:'TRICICLO ROOFHYBRID',cat:'triciclo',motor:'Híbrido litio',color:'',precio:5700,comision:500,activo:true},
  {n:32,nombre:'TRICICLO HIBRIDO SOLAR',cat:'triciclo',motor:'Híbrido litio',color:'',precio:5350,comision:500,activo:true},
  {n:33,nombre:'TRICICLO HIBRIDO LITIO',cat:'triciclo',motor:'Híbrido litio',color:'',precio:5250,comision:500,activo:true},
  {n:34,nombre:'TRICICLO HIBRIDO GEL',cat:'triciclo',motor:'Híbrido gel',color:'',precio:5000,comision:500,activo:true},
  {n:35,nombre:'TRICICLO ELECTRICO',modelo:'TRICICLO ELECTRICO PASAJEROS / CARGA',cat:'triciclo',marca:'MZ',motor:'Eléctrico',color:'',precio:4500,comision:500,activo:true},
  {n:36,nombre:'KIT 2',modelo:'KIT 2 SAKO',cat:'kit',marca:'SAKO',color:'',precio:7200,comision:500,activo:true},
  {n:37,nombre:'KIT 1',modelo:'KIT 1 SAKO',cat:'kit',marca:'SAKO',color:'',precio:6350,comision:500,activo:true},
  {n:38,nombre:'KIT RESIDENCIAL',modelo:'KIT RESIDENCIAL 6KW',cat:'kit',color:'',precio:5600,comision:500,activo:true},
  {n:39,nombre:'KIT MUST',modelo:'KIT MUST',cat:'kit',marca:'MUST',color:'',precio:4600,comision:500,activo:true},
  {n:40,nombre:'BATERIA 15K',cat:'kit',color:'',precio:2500,comision:100,activo:true},
  {n:41,nombre:'INVERSOR 10K',cat:'kit',color:'',precio:2000,comision:0,activo:true},
  {n:42,nombre:'PANEL SOLAR',cat:'kit',color:'',precio:230,comision:0,activo:true},
  {n:43,nombre:'RIVER 2',cat:'kit',color:'',precio:1000,comision:175,activo:true},
  {n:44,nombre:'DELTA 3 CLASSIC',cat:'kit',color:'',precio:1250,comision:200,activo:true},
  {n:45,nombre:'DELTA 3 PLUS',cat:'kit',color:'',precio:1500,comision:200,activo:true},
  {n:46,nombre:'DELTA 2 MAX',cat:'kit',color:'',precio:1950,comision:250,activo:true},
  {n:47,nombre:'DELTA PRO',modelo:'ECOFLOW DELTA PRO',cat:'kit',color:'',precio:2900,comision:300,activo:true}
];
const DEFAULT_FINANCIERAS=[
  {n:'US BANK CARITAS',fee:0.04,tax:true,dias:'Todos los días'},{n:'US BANK EVERLY',fee:0.08,tax:true,dias:'Todos los días'},
  {n:'KIWIPAY (FL)',fee:0.18,tax:false,dias:'Todos los días'},{n:'ÁCIMA',fee:0,tax:true,dias:'Lun a Mié'},
  {n:'KAFENE (FL)',fee:0.10,tax:false,dias:'Mié a Vie'},{n:'PROGRESSIVE',fee:0.10,tax:false,dias:'Lun a Mié'},
  {n:'KOALAFI',fee:0.10,tax:false,dias:'Mié a Vie'},{n:'SNAP',fee:0.10,tax:false,dias:'Lun a Mié'},
  {n:'AFF',fee:0.15,tax:false,dias:'Mié a Vie'},{n:'EASYPAY (FL)',fee:0.10,tax:false,dias:'Lun a Mié'}
];
function loadInventario(){try{return JSON.parse(fs.readFileSync(INVPATH,'utf8'))}catch(e){return null}}
function saveInventario(a){fs.writeFileSync(INVPATH,JSON.stringify(a,null,1))}
function loadFinancieras(){try{return JSON.parse(fs.readFileSync(FINPATH,'utf8'))}catch(e){return null}}
function saveFinancieras(a){fs.writeFileSync(FINPATH,JSON.stringify(a,null,1))}
function loadOrdenes(){try{return JSON.parse(fs.readFileSync(ORDPATH,'utf8'))}catch(e){return null}}
function saveOrdenes(a){fs.writeFileSync(ORDPATH,JSON.stringify(a,null,1))}
function loadAud(){try{return JSON.parse(fs.readFileSync(AUDPATH,'utf8'))}catch(e){return []}}
function saveAud(a){try{fs.writeFileSync(AUDPATH,JSON.stringify(a))}catch(e){}}
// Contador atómico (Node es un solo hilo → estas lecturas/escrituras no se intercalan).
// El piso se deriva de los datos reales para no colisionar nunca con números ya existentes.
function nextSeq(name){
  let s={};try{s=JSON.parse(fs.readFileSync(SEQPATH,'utf8'))}catch(e){s={};}
  let floor=Number(s[name]||0);
  if(name==='venta'){try{loadClientes().forEach(c=>{if(Number(c.ventaNum)>floor)floor=Number(c.ventaNum);});}catch(e){}}
  else if(name==='orden'){try{(loadOrdenes()||[]).forEach(o=>{if(Number(o.num)>floor)floor=Number(o.num);});}catch(e){}}
  const n=floor+1;s[name]=n;try{fs.writeFileSync(SEQPATH,JSON.stringify(s));}catch(e){}return n;
}
// Enriquecer inventario existente con marca/modelo/motor/cc/comisión (sin tocar precio, color, fotos ni info)
function migrateInventario(){
  try{
    const inv=loadInventario();if(!inv||!Array.isArray(inv))return;
    const norm=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const byName={};DEFAULT_INVENTARIO.forEach(d=>{byName[norm(d.nombre)]=d;});
    let changed=false;
    inv.forEach(p=>{const d=byName[norm(p.nombre)];if(!d)return;
      ['marca','modelo','motor','cc','comision'].forEach(k=>{
        if((p[k]===undefined||p[k]===null||p[k]==='')&&d[k]!==undefined&&d[k]!==''){p[k]=d[k];changed=true;}
      });
      if(p.activo===undefined){p.activo=true;changed=true;}
      // corrección puntual: KIT RESIDENCIAL y DELTA PRO no son RIDERS
      if((norm(p.nombre)===norm('KIT RESIDENCIAL')||norm(p.nombre)===norm('DELTA PRO'))&&p.marca==='RIDERS'){p.marca='';changed=true;}
    });
    if(changed)saveInventario(inv);
  }catch(e){}
}
// Solo sembramos el inventario si no existe. NO corremos migrateInventario() en cada arranque:
// antes rellenaba los campos vacíos desde el default y pisaba las ediciones (ej: modelo borrado a mano,
// que "volvía a aparecer" en cada reinicio de Render). El default ya viene enriquecido para instalaciones nuevas.
try{if(!loadInventario())saveInventario(DEFAULT_INVENTARIO);}catch(e){}
try{if(!loadFinancieras())saveFinancieras(DEFAULT_FINANCIERAS);}catch(e){}
// Huella de la versión servida (cambia en cada deploy porque cambia index.html)
const APP_VER=(()=>{try{const st=fs.statSync(path.join(DIR,'index.html'));return String(Math.round(st.mtimeMs))+'-'+st.size;}catch(e){return 'v'+Date.now();}})();

function loadClientes(){try{return JSON.parse(fs.readFileSync(DATA,'utf8'))}catch(e){return []}}
function saveClientes(arr){fs.writeFileSync(DATA,JSON.stringify(arr,null,1));try{autoBackup();}catch(e){}}
function saveCfg(){fs.writeFileSync(CFGPATH,JSON.stringify(CFG,null,2))}

/* ============================================================
   USUARIOS / AUTENTICACIÓN / ROLES  (admin, supervisor, vendedor)
   ============================================================ */
const crypto=require('crypto');
const USERS=path.join(DATA_DIR,'users.json');
function loadUsers(){try{return JSON.parse(fs.readFileSync(USERS,'utf8'))}catch(e){return []}}
function saveUsers(arr){fs.writeFileSync(USERS,JSON.stringify(arr,null,1))}
function uidU(){return 'u'+Math.random().toString(36).slice(2,9)}

/* ============================================================
   COPIAS DE SEGURIDAD (backups): rotativas en disco + envío diario a Telegram
   ============================================================ */
const BKDIR=path.join(DATA_DIR,'backups');
try{if(!fs.existsSync(BKDIR))fs.mkdirSync(BKDIR,{recursive:true});}catch(e){}
function _p2(n){return String(n).padStart(2,'0');}
function _stamp(){const d=new Date();return d.getFullYear()+_p2(d.getMonth()+1)+_p2(d.getDate())+'-'+_p2(d.getHours())+_p2(d.getMinutes());}
function _snapshot(){
  let cl='[]',us='[]';
  try{cl=fs.readFileSync(DATA,'utf8');}catch(e){}
  try{us=fs.readFileSync(USERS,'utf8');}catch(e){}
  let clA=[],usA=[];try{clA=JSON.parse(cl);}catch(e){}try{usA=JSON.parse(us);}catch(e){}
  return JSON.stringify({fecha:new Date().toISOString(),clientes:clA,users:usA});
}
// Guarda un snapshot con un prefijo y conserva solo los últimos `keep` de ese prefijo.
function writeBackup(prefix,name,keep){
  try{
    fs.writeFileSync(path.join(BKDIR,prefix+'-'+name+'.json'),_snapshot());
    const files=fs.readdirSync(BKDIR).filter(f=>f.indexOf(prefix+'-')===0&&f.endsWith('.json')).sort();
    while(files.length>keep){const old=files.shift();try{fs.unlinkSync(path.join(BKDIR,old));}catch(e){}}
    return prefix+'-'+name+'.json';
  }catch(e){console.log('[backup] error:',e.message);return null;}
}
// Auto-backup en cada guardado, como mucho 1 cada 15 min (para recuperar borrados del día).
let _lastAutoBk=0;
function autoBackup(){const now=Date.now();if(now-_lastAutoBk<15*60000)return;_lastAutoBk=now;writeBackup('auto',_stamp(),48);}
// Envío multipart a Telegram (sin dependencias) del archivo de respaldo.
function tgSendDocument(chatId,filename,content){return new Promise(resolve=>{
  if(!CFG.telegramToken||!chatId)return resolve(false);
  const b='----crmbk'+Date.now();
  const pre=Buffer.from('--'+b+'\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n'+chatId+'\r\n'+
    '--'+b+'\r\nContent-Disposition: form-data; name="caption"\r\n\r\n🗂️ Respaldo automático del CRM · '+filename+'\r\n'+
    '--'+b+'\r\nContent-Disposition: form-data; name="document"; filename="'+filename+'"\r\nContent-Type: application/json\r\n\r\n','utf8');
  const post=Buffer.from('\r\n--'+b+'--\r\n','utf8');
  const body=Buffer.concat([pre,Buffer.from(content,'utf8'),post]);
  const req=https.request('https://api.telegram.org/bot'+CFG.telegramToken+'/sendDocument',{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary='+b,'Content-Length':body.length}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>resolve(true));});
  req.on('error',()=>resolve(false));req.write(body);req.end();
});}
// Backup diario (1 por día): guarda snapshot 'daily' (30 días) y lo manda a tu Telegram.
function maybeDailyBackup(){
  const today=new Date().toISOString().slice(0,10);
  let mark='';try{mark=fs.readFileSync(path.join(BKDIR,'.lastdaily'),'utf8').trim();}catch(e){}
  if(mark===today)return;
  const fname=writeBackup('daily',today.replace(/-/g,''),30);
  try{fs.writeFileSync(path.join(BKDIR,'.lastdaily'),today);}catch(e){}
  if(fname&&CFG.allowedChatId)tgSendDocument(CFG.allowedChatId,fname,_snapshot());
  console.log('[backup] diario:',fname||'(falló)');
}
function hashPass(pass,salt){salt=salt||crypto.randomBytes(16).toString('hex');const hash=crypto.scryptSync(String(pass),salt,64).toString('hex');return {salt,hash};}
function verifyPass(pass,salt,hash){try{const h=crypto.scryptSync(String(pass),salt,64).toString('hex');const a=Buffer.from(h),b=Buffer.from(hash);return a.length===b.length&&crypto.timingSafeEqual(a,b);}catch(e){return false;}}
// Tokens firmados (stateless): NO dependen de la memoria del servidor → la sesión sobrevive
// a los reinicios de Render, así el usuario queda logueado y no tiene que entrar cada vez.
const SECRETPATH=path.join(DATA_DIR,'.secret');
let SESSION_SECRET=process.env.SESSION_SECRET||'';
if(!SESSION_SECRET){try{SESSION_SECRET=fs.readFileSync(SECRETPATH,'utf8').trim();}catch(e){}}
if(!SESSION_SECRET){SESSION_SECRET=crypto.randomBytes(32).toString('hex');try{fs.writeFileSync(SECRETPATH,SESSION_SECRET);}catch(e){}}
function _b64u(buf){return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function _sign(payload){return _b64u(crypto.createHmac('sha256',SESSION_SECRET).update(payload).digest());}
function newSession(userId){const payload=_b64u(JSON.stringify({uid:userId,exp:Date.now()+90*24*3600*1000}));return payload+'.'+_sign(payload);}
function tokenUid(tok){
  if(!tok||tok.indexOf('.')<0)return null;
  const i=tok.lastIndexOf('.'),payload=tok.slice(0,i),sig=tok.slice(i+1),good=_sign(payload);
  try{if(sig.length!==good.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(good)))return null;}catch(e){return null;}
  let d;try{d=JSON.parse(Buffer.from(payload.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8'));}catch(e){return null;}
  if(!d||!d.uid||!d.exp||d.exp<Date.now())return null;
  return d.uid;
}
function userFromReq(req){const h=req.headers['authorization']||'';const t=h.startsWith('Bearer ')?h.slice(7):'';const uid=tokenUid(t);if(!uid)return null;return loadUsers().find(u=>u.id===uid&&u.activo!==false)||null;}
function publicUser(u){return u?{id:u.id,nombre:u.nombre,apellido:u.apellido||'',telefono:u.telefono||'',email:u.email||'',usuario:u.usuario,rol:u.rol,supervisorId:u.supervisorId||null,activo:u.activo!==false,tgLinked:!!u.telegramChatId,pushOn:!!(u.pushSubs&&u.pushSubs.length)}:null;}
// Códigos de vinculación de Telegram (persistidos para sobrevivir a reinicios/deploys)
const TGCODEPATH=path.join(DATA_DIR,'tgcodes.json');
function loadTgCodes(){try{return JSON.parse(fs.readFileSync(TGCODEPATH,'utf8'))}catch(e){return {}}}
function saveTgCodes(o){try{fs.writeFileSync(TGCODEPATH,JSON.stringify(o))}catch(e){}}
function genTgCode(uid){const o=loadTgCodes();const code=String(Math.floor(100000+Math.random()*900000));o[code]={uid,exp:Date.now()+30*60000};saveTgCodes(o);return code;}
function consumeTgCode(code){const o=loadTgCodes();const e=o[code];if(!e||e.exp<Date.now())return null;delete o[code];saveTgCodes(o);return e.uid;}
function adminUser(){return loadUsers().find(u=>u.rol==='admin');}

/* ---------- WhatsApp: entra un mensaje → se crea/actualiza la consulta en el CRM ---------- */
function procesarWebhook(body){
  if(!body||!Array.isArray(body.entry))return;
  const clientes=loadClientes();const map=loadWaMap();const admin=adminUser();let changed=false;
  const paraResponder=[]; // {id,texto} → los contesta el asistente después de guardar
  for(const e of body.entry){
    for(const ch of (e.changes||[])){
      const v=ch.value||{};const pnid=(v.metadata&&v.metadata.phone_number_id)||'';
      const vendId=map[pnid]||(admin&&admin.id)||''; // por número: al vendedor dueño; si no está mapeado, al admin
      const contacts=v.contacts||[];
      for(const m of (v.messages||[])){
        if(!m||m.type==='reaction'||m.type==='system')continue;
        if(!m.referral)continue; // SOLO leads que vienen de un anuncio (Click-to-WhatsApp). Ignora chats normales, grupos, etc.
        const from=m.from||'';const dig=String(from).replace(/\D/g,'');if(dig.length<6)continue;
        const ct=contacts.find(x=>x.wa_id===from)||{};const nombre=(ct.profile&&ct.profile.name)||('+'+dig);
        const texto=m.text?m.text.body:(m.button?m.button.text:(m.interactive&&m.interactive.button_reply?m.interactive.button_reply.title:('['+(m.type||'mensaje')+']')));
        const fecha=hoy(),hora=ahora();
        let c=clientes.find(x=>!x.borrado&&!x.descartado&&x.vendedorId===vendId&&(()=>{const cd=String(x.whatsapp||'').replace(/\D/g,'');return cd.length>=7&&(cd.endsWith(dig)||dig.endsWith(cd));})());
        if(c){
          c.mensajes=c.mensajes||[];c.mensajes.push({de:'cliente',fecha,hora,texto,canal:'whatsapp'});
          c.ultimoContacto=fecha;c.respondioUltimo='cliente';
        }else{
          c={id:uid(),nombre,whatsapp:'+'+dig,producto:'Otro',etapa:'nuevo',valor:0,proximo:fecha,proximoTipo:'Seguimiento',proximoHora:'',creado:fecha,creadoTs:Date.now(),ultimoContacto:fecha,respondioUltimo:'cliente',canal:'whatsapp',vendedorId:vendId,sinAtender:true,log:[{fecha,hora,texto}],mensajes:[{de:'cliente',fecha,hora,texto,canal:'whatsapp'}]};
          if(m.referral){c.origen='ad';c.adReferral={titulo:m.referral.headline||'',cuerpo:m.referral.body||'',url:m.referral.source_url||'',id:m.referral.source_id||m.referral.ctwa_clid||''};c.log.unshift({fecha,hora,texto:'🟢 Consulta desde un anuncio'+(m.referral.headline?': '+m.referral.headline:'')});}
          clientes.push(c);
          try{if(typeof pushToUser==='function'&&vendId)pushToUser(vendId,{title:'🆕 Nueva consulta',body:nombre+': '+String(texto).slice(0,80)});}catch(e){}
        }
        paraResponder.push({id:c.id,texto:texto});
        changed=true;
      }
    }
  }
  if(changed)saveClientes(clientes);
  // El asistente contesta aparte: tarda (delay humano + IA) y el webhook de
  // Meta tiene que responder 200 al instante o reintenta el mensaje.
  paraResponder.forEach(x=>{setTimeout(()=>asistenteResponder(x.id,x.texto),0);});
}

/* ---------- Notificaciones push al celular (Web Push, sin Telegram) ---------- */
let webpush=null;try{webpush=require('web-push');}catch(e){console.log('[push] web-push no disponible, push deshabilitado');}
let VAPID=null;
if(webpush){
  const VPATH=path.join(DATA_DIR,'.vapid');
  if(process.env.VAPID_PUBLIC&&process.env.VAPID_PRIVATE)VAPID={publicKey:process.env.VAPID_PUBLIC,privateKey:process.env.VAPID_PRIVATE};
  if(!VAPID){try{VAPID=JSON.parse(fs.readFileSync(VPATH,'utf8'));}catch(e){}}
  if(!VAPID){try{VAPID=webpush.generateVAPIDKeys();fs.writeFileSync(VPATH,JSON.stringify(VAPID));}catch(e){}}
  try{if(VAPID)webpush.setVapidDetails('mailto:crm@ridersmiami.com',VAPID.publicKey,VAPID.privateKey);else webpush=null;}catch(e){webpush=null;}
}
function pushPubKey(){return VAPID?VAPID.publicKey:'';}
function addPushSub(userId,sub){const users=loadUsers();const u=users.find(x=>x.id===userId);if(!u||!sub||!sub.endpoint)return false;u.pushSubs=u.pushSubs||[];if(!u.pushSubs.some(s=>s.endpoint===sub.endpoint))u.pushSubs.push(sub);saveUsers(users);return true;}
function removePushSub(userId,endpoint){const users=loadUsers();const u=users.find(x=>x.id===userId);if(!u||!u.pushSubs)return;u.pushSubs=u.pushSubs.filter(s=>s.endpoint!==endpoint);saveUsers(users);}
function pushToUser(userId,payload){
  if(!webpush)return false;
  const u=loadUsers().find(x=>x.id===userId);if(!u||!u.pushSubs||!u.pushSubs.length)return false;
  const dead=[];
  u.pushSubs.forEach(s=>{webpush.sendNotification(s,JSON.stringify(payload)).catch(err=>{if(err&&(err.statusCode===410||err.statusCode===404))dead.push(s.endpoint);});});
  if(dead.length)setTimeout(()=>{const us=loadUsers();const uu=us.find(x=>x.id===userId);if(uu&&uu.pushSubs){uu.pushSubs=uu.pushSubs.filter(s=>!dead.includes(s.endpoint));saveUsers(us);}},4000);
  return true;
}

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
  if(user.rol==='vendedor')return c.vendedorId===user.id&&!c.descartado; // los descartados quedan solo para el admin
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
  // NO borramos por ausencia: un POST con lista vieja (pestaña desactualizada) borraría
  // clientes nuevos creados por otros usuarios / webhook / bot. El borrado es explícito
  // (soft-delete c.borrado/c.descartado, o el endpoint /api/cliente-delete).
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
  const esVend=c=>(c.etapa==='vendido'||c.etapa==='posventa')&&!c.anulada;
  const vendidosMes=cl.filter(c=>esVend(c)&&(c.vendidoFecha||'').slice(0,7)===mes);
  const facturadoMes=vendidosMes.reduce((s,c)=>s+(Number(c.valor)||0),0);
  const comisionMes=vendidosMes.reduce((s,c)=>s+(Number(c.comision)||0),0);
  const ventasTot=cl.filter(esVend).length;
  const abiertos=cl.filter(c=>!esVend(c));
  const abandonados=abiertos.filter(c=>{const ref=ultimoLogFecha(c)||c.ultimoContacto||c.creado||'';return ref&&ref<catorce;});
  const ultAct=cl.reduce((f,c)=>{const l=ultimoLogFecha(c);return l>f?l:f;},'');
  return {
    total:cl.length,
    ventas:cl.filter(c=>c.etapa==='vendido'&&!c.anulada).length,
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
  if(!c&&crearKW){const nom=nuevoNombre(text);if(nom){c={id:uid(),nombre:nom,whatsapp:'',producto:detProducto(text)||'Otro',ubicacion:'',etapa:'nuevo',valor:0,proximo:hoy(),proximoTipo:'Seguimiento',creado:hoy(),creadoTs:Date.now(),ultimoContacto:hoy(),respondioUltimo:'cliente',log:[],mensajes:[]};clientes.push(c);acc.push('creé el cliente *'+nom+'*');}}
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
// Visión: una llamada a un modelo, con timeout. Devuelve {status, text}
function _geminiVisionOnce(model,parts){return new Promise((resolve)=>{
  const body=JSON.stringify({contents:[{parts}],generationConfig:{temperature:0.1,responseMimeType:'application/json'}});
  let done=false;const fin=v=>{if(!done){done=true;resolve(v);}};
  const req=https.request('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+CFG.geminiKey,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{let txt=null;try{const j=JSON.parse(d);txt=j.candidates&&j.candidates[0]&&j.candidates[0].content.parts[0].text;}catch(e){}fin({status:r.statusCode,text:txt||null});})});
  req.setTimeout(9000,()=>{req.destroy();fin({status:0,text:null});}); // modelo lento → abandonar y probar el siguiente
  req.on('error',()=>fin({status:0,text:null}));req.write(body);req.end();
});}
// Cadena de modelos de visión (ordenada por confiabilidad/velocidad). Si uno está saturado (503), salta al siguiente.
// gemini-flash-latest (el alias genérico) se satura seguido; los específicos suelen estar más libres.
const VISION_MODELS=(CFG.geminiVisionModels||'gemini-3-flash-preview,gemini-3.5-flash-lite,gemini-flash-latest,gemini-3.5-flash').split(',').map(s=>s.trim()).filter(Boolean);
// Cadena de modelos sobre 'parts' ya armadas (texto + inline_data). Devuelve {ok,text,model} o {ok:false,reason}
async function geminiChain(parts){
  if(!CFG.geminiKey||CFG.geminiKey.length<10)return {ok:false,reason:'noconfig'};
  let last=0;
  for(let pass=0;pass<2;pass++){
    for(const m of VISION_MODELS){
      const r=await _geminiVisionOnce(m,parts);
      if(r.text)return {ok:true,text:r.text,model:m};
      last=r.status;
    }
    if(pass===0)await new Promise(res=>setTimeout(res,1000));
  }
  return {ok:false,reason:[429,500,503,0].includes(last)?'overload':'unreadable',status:last};
}
// Visión: arma parts a partir de imágenes/archivos + prompt
async function geminiVision(images,prompt){
  const parts=[{text:prompt}].concat((images||[]).map(im=>({inline_data:{mime_type:im.mime||'image/jpeg',data:im.data}})));
  return geminiChain(parts);
}

/* ---------- Asistente de WhatsApp para leads de anuncios ---------- */
const ASIS=require('./asistente.js')({fs,path,DATA_DIR,geminiChain,hoy,ahora});
// Credenciales de la API de WhatsApp (Meta). Mientras no estén, el asistente
// trabaja en MODO BORRADOR: escribe la respuesta y la deja anotada en el chat
// del cliente para que Octa la vea, pero no la manda.
const WA_TOKEN=process.env.WHATSAPP_TOKEN||CFG.whatsappToken||'';
const WA_PHONE_ID=process.env.WHATSAPP_PHONE_ID||CFG.whatsappPhoneId||'';
const WA_LISTO=!!(WA_TOKEN&&WA_PHONE_ID);
function waEnviar(to,texto){return new Promise(resolve=>{
  if(!WA_LISTO)return resolve({ok:false,reason:'sin-numero'});
  const body=JSON.stringify({messaging_product:'whatsapp',to:String(to).replace(/\D/g,''),type:'text',text:{preview_url:false,body:String(texto).slice(0,4000)}});
  const req=https.request('https://graph.facebook.com/v21.0/'+WA_PHONE_ID+'/messages',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+WA_TOKEN,'Content-Length':Buffer.byteLength(body)}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>resolve({ok:r.statusCode>=200&&r.statusCode<300,status:r.statusCode,body:d}));});
  req.setTimeout(15000,()=>{req.destroy();resolve({ok:false,reason:'timeout'});});
  req.on('error',e=>resolve({ok:false,reason:e.message}));req.write(body);req.end();
});}

// Contesta un mensaje entrante. Se llama desde el webhook y no bloquea la
// respuesta HTTP a Meta: espera el delay humano y recién ahí manda.
async function asistenteResponder(clienteId,texto){
  const cfg=ASIS.cargarCfg();
  if(!cfg.activo)return;
  try{
    let arr=loadClientes();let c=arr.find(x=>x.id===clienteId);
    if(!c)return;
    if(cfg.soloAnuncios&&c.origen!=='ad')return;
    if(c.asis&&['handoff','descartado','frio'].includes(c.asis.estado))return; // ya está en manos de un humano (o descartado)
    if(!ASIS.enHorario(cfg))return; // fuera de horario: contesta a la mañana el humano

    const res=await ASIS.responder({cliente:c,texto,cfg,inventario:loadInventario()||DEFAULT_INVENTARIO,financieras:loadFinancieras()||DEFAULT_FINANCIERAS});

    // Espera humana antes del primer mensaje
    const delays=res.delays||[];
    for(let i=0;i<res.mensajes.length;i++){
      await new Promise(r=>setTimeout(r,Math.min(120000,delays[i]||3000)));
      const envio=(cfg.simulacion||!WA_LISTO)?{ok:false,reason:'borrador'}:await waEnviar(c.whatsapp,res.mensajes[i]);
      // Releer siempre: pudo haber cambiado mientras esperábamos
      arr=loadClientes();c=arr.find(x=>x.id===clienteId);if(!c)return;
      c.mensajes=c.mensajes||[];
      c.mensajes.push({de:'yo',fecha:hoy(),hora:ahora(),texto:res.mensajes[i],canal:'whatsapp',bot:true,borrador:!envio.ok});
      c.ultimoContacto=hoy();c.respondioUltimo='yo';
      saveClientes(arr);
    }

    // Guardar el estado del filtro sobre el cliente ya persistido
    arr=loadClientes();c=arr.find(x=>x.id===clienteId);if(!c)return;
    c.asis=res.cliente&&res.cliente.asis?res.cliente.asis:c.asis;
    c.asis=c.asis||{datos:{},msgs:0,estado:'activo'};
    Object.assign(c.asis.datos=c.asis.datos||{},res.datos||{});
    if(res.resumen)c.asis.resumen=res.resumen;
    if(res.handoff){c.asis.estado='handoff';c.asis.motivo=res.motivo||'';c.sinAtender=true;
      // Cortes que son buena noticia (mandó una cotización de otro lado, insiste
      // con el precio): ese lead está para llamarlo ya, no para la cola.
      if(res.caliente)c.tags=Array.from(new Set([...(c.tags||[]),'caliente']));}
    if(res.listo){c.asis.estado='listo';c.etapa=c.etapa==='nuevo'?'interesado':c.etapa;c.tags=Array.from(new Set([...(c.tags||[]),'caliente']));c.sinAtender=true;}
    if(res.frio){c.asis.estado='frio';c.tags=Array.from(new Set([...(c.tags||[]),'frio']));}
    if(res.descartar)c.asis.estado='descartado';
    if(res.datos&&res.datos.producto&&(!c.producto||c.producto==='Otro'))c.producto=detProducto(res.datos.producto)||c.producto;
    if(res.datos&&res.datos.pago)c.operacion=/financ/i.test(res.datos.pago)?'Financiado':'Cash';
    c.log=c.log||[];
    if(res.handoff)c.log.push({fecha:hoy(),hora:ahora(),texto:'🤖 El asistente pasó el chat a un humano: '+(res.motivo||'')});
    if(res.listo)c.log.push({fecha:hoy(),hora:ahora(),texto:'🤖 Lead calificado — '+(res.resumen||'listo para llamar')});
    saveClientes(arr);

    if(cfg.avisarPush&&(res.listo||res.handoff)){
      try{if(c.vendedorId)pushToUser(c.vendedorId,ASIS.avisoLead(c,res));}catch(e){}
    }
  }catch(e){console.log('[asistente] error:',e.message);}
}

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
      c={id:uid(),nombre:a.cliente||num||'Nuevo',whatsapp:num||'',producto:a.producto||'Otro',operacion:a.operacion||'',ubicacion:'',etapa:a.etapa||'nuevo',valor:a.valor||0,proximo:hoy(),proximoTipo:'Seguimiento',creado:hoy(),creadoTs:Date.now(),ultimoContacto:hoy(),respondioUltimo:'cliente',canal:'whatsapp',log:[],mensajes:[]};
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

// El bot trabaja SCOPEADO a la cuenta del usuario: el vendedor solo ve/toca SUS clientes por el
// chat, y lo que crea queda a su nombre. NUNCA puede ver ni modificar clientes de otra cuenta.
async function procesarMensajeUser(text,user){
  const all=loadClientes();
  const esMio=c=>user.rol==='admin'?true:(c.vendedorId===user.id); // admin ve todo; vendedor solo lo suyo
  const scope=all.filter(esMio);
  const r=(CFG.geminiKey&&CFG.geminiKey.length>10)?await geminiBrain(scope,text):parseBrain(scope,text);
  if(r.changed){
    scope.forEach(c=>{if(!c.vendedorId)c.vendedorId=user.id;}); // clientes nuevos → a nombre de quien escribe
    const byId={};all.forEach(c=>byId[c.id]=c);scope.forEach(c=>{byId[c.id]=c;}); // fusiona sin tocar los ajenos
    saveClientes(Object.values(byId));
  }
  return r.reply;
}

/* ---------- Telegram ---------- */
function tg(method,params){return new Promise((resolve)=>{const body=JSON.stringify(params);const req=https.request('https://api.telegram.org/bot'+CFG.telegramToken+'/'+method,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){resolve({ok:false})}})});req.on('error',()=>resolve({ok:false}));req.write(body);req.end();});}
function reply(chatId,text){return tg('sendMessage',{chat_id:chatId,text:text,parse_mode:'Markdown'});}

async function handle(msg){
  const chatId=msg.chat.id;const text=(msg.text||'').trim();if(!text)return;
  // Vinculación de vendedores: /start CODE, /vincular CODE, o un código de 6 dígitos suelto
  const mcode=text.match(/^\/?(?:start|vincular|codigo|código)[\s:]+(\w{4,10})$/i)||text.match(/^\s*(\d{5,7})\s*$/);
  if(mcode){
    const uid=consumeTgCode(mcode[1]);
    if(uid){const users=loadUsers();const usr=users.find(u=>u.id===uid);if(usr){usr.telegramChatId=chatId;saveUsers(users);await reply(chatId,'✅ Listo'+(usr.nombre?', '+usr.nombre:'')+'. Vas a recibir acá los recordatorios de tus contactos.');return;}}
    await reply(chatId,'❌ Ese código no es válido o venció. Generá uno nuevo desde el CRM (botón 🔔 Avisos).');return;
  }
  if(CFG.allowedChatId===null||CFG.allowedChatId===undefined){
    CFG.allowedChatId=chatId;saveCfg();
    await reply(chatId,'✅ ¡Hola Octa! Soy el *asistente del CRM de Riders Miami*.\nContame en una frase qué pasó con un cliente y lo *anoto solo*.\n\nEjemplos:\n• _Oscar quiere financiar, llamarlo el lunes_\n• _cargá a Juan, preguntó por una moto_\n• _Yosvani ya pagó, marcalo vendido_');
    return;
  }
  // ¿Quién es este chat? El admin (chat fijado) o un usuario vinculado por código.
  let user=(chatId===CFG.allowedChatId)?adminUser():null;
  if(!user)user=loadUsers().find(u=>u.telegramChatId===chatId&&u.activo!==false);
  if(!user){await reply(chatId,'🔒 Este bot es privado. Si sos vendedor de Riders, entrá al CRM → 🔔 Avisos y seguí las instrucciones para vincularlo.');return;}
  if(user.rol==='supervisor'||user.rol==='dueno'){await reply(chatId,'🔔 Tus recordatorios están activados. Tu cuenta es de supervisión (solo lectura): no carga clientes por el bot.');return;}
  if(text==='/start'||text==='/ayuda'||text==='/help'){await reply(chatId,'👋 Contame qué pasó con *un cliente tuyo* y lo anoto solo. Ej:\n• _Oscar quiere financiar, llamarlo el lunes_\n• _cargá a Juan, preguntó por una moto_\n• _Yosvani ya pagó, marcalo vendido_\n\n🔒 Solo podés ver y cargar TUS clientes.');return;}
  try{const res=await procesarMensajeUser(text,user);await reply(chatId,res);}catch(e){await reply(chatId,'⚠️ Ups, algo falló: '+e.message);}
}
/* ---------- Recordatorios: avisar cuando llega la hora de un contacto ---------- */
const NOTIFPATH=path.join(DATA_DIR,'notified.json');
let _notif=null;
function loadNotif(){if(_notif)return _notif;try{_notif=JSON.parse(fs.readFileSync(NOTIFPATH,'utf8'));}catch(e){_notif={};}return _notif;}
function saveNotif(){try{fs.writeFileSync(NOTIFPATH,JSON.stringify(_notif));}catch(e){}}
function dueTime(c){if(!c.proximo)return null;let h=(c.proximoHora&&/^\d{1,2}:\d{2}/.test(c.proximoHora))?c.proximoHora:'09:00';if(h.length===4)h='0'+h;const dt=new Date(c.proximo+'T'+h+':00');return isNaN(dt)?null:dt.getTime();}
function checkDue(){
  try{
    const now=Date.now(),cl=loadClientes(),users=loadUsers(),nt=loadNotif();let changed=false;
    for(const c of cl){
      if(c.borrado)continue;const due=dueTime(c);if(due===null)continue;
      if(due<=now&&due>=now-6*3600000){
        const k=c.id+'|'+c.proximo+'|'+(c.proximoHora||'');
        if(nt[k])continue;
        const vend=users.find(u=>u.id===c.vendedorId);
        // Un cliente recien llegado (nunca contactado) se avisa como NUEVO, no como seguimiento
        const esNuevo=((c.etapa||'nuevo')==='nuevo')&&!(c.log&&c.log.length)&&!c.ultimoContacto;
        const quien=c.nombre+(c.whatsapp?' ('+c.whatsapp+')':'');
        const txt=esNuevo?('🆕 *Nuevo cliente*: '+quien+' — contactalo'):('🔔 Recordatorio: es hora de tu '+(c.proximoTipo||'seguimiento')+' con '+quien);
        let sent=false;
        if(vend&&vend.telegramChatId){tg('sendMessage',{chat_id:vend.telegramChatId,text:txt});sent=true;}
        if(typeof pushToUser==='function'&&vend){try{if(pushToUser(vend.id,{title:esNuevo?'🆕 Nuevo cliente':'Recordatorio de contacto',body:esNuevo?('Contactá a '+c.nombre):('Es hora de tu '+(c.proximoTipo||'seguimiento')+' con '+c.nombre),cid:c.id}))sent=true;}catch(e){}}
        if(sent){nt[k]=now;changed=true;}
      }
    }
    if(changed){const ks=Object.keys(nt);if(ks.length>5000){ks.sort((a,b)=>nt[a]-nt[b]).slice(0,ks.length-2000).forEach(k=>delete nt[k]);}saveNotif();}
  }catch(e){console.log('[recordatorios] error:',e.message);}
}

let offset=0,botLastOk=0,botLastErr='',botUsername='',botMeErr='';
function fetchBotUsername(){
  if(!CFG.telegramToken||CFG.telegramToken.length<20){botMeErr='falta el token (TELEGRAM_TOKEN) en el servidor';return;}
  tg('getMe').then(r=>{if(r&&r.ok&&r.result&&r.result.username){botUsername=r.result.username;botMeErr='';}else{botMeErr=r&&r.description?('['+(r.error_code||'?')+'] '+r.description):'Telegram no respondió';}}).catch(e=>{botMeErr=(e&&e.message)||'error de red';});
}
async function poll(){
  try{const upd=await tg('getUpdates',{offset:offset,timeout:30});
    if(upd&&upd.ok){botLastOk=Date.now();botLastErr='';for(const u of upd.result){offset=u.update_id+1;if(u.message)await handle(u.message);}}
    else if(upd&&upd.error_code){botLastErr='['+upd.error_code+'] '+(upd.description||'');}
  }catch(e){botLastErr=e.message||String(e);}
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

  // Nombre real del bot (público — el @usuario de un bot es público)
  if(u==='/api/bot-info'&&req.method==='GET')return json(200,{bot:botUsername||CFG.telegramBotUser||'RidersCRM_bot',ok:!!botUsername});

  // Webhook de WhatsApp (Meta): verificación (GET) y recepción de mensajes (POST)
  if(u==='/webhook'&&req.method==='GET'){
    const qp=new URLSearchParams(req.url.split('?')[1]||'');
    if(qp.get('hub.mode')==='subscribe'&&qp.get('hub.verify_token')===WA_VERIFY){res.writeHead(200,{'Content-Type':'text/plain'});return res.end(qp.get('hub.challenge')||'');}
    res.writeHead(403);return res.end('no');
  }
  if(u==='/webhook'&&req.method==='POST')return readBody(body=>{try{procesarWebhook(body);}catch(e){console.log('[webhook] error:',e.message);}json(200,{ok:true});});

  // Login (sin auth)
  if(u==='/api/login'&&req.method==='POST')return readBody(body=>{
    const us=String(body.usuario||'').trim().toLowerCase();
    const user=loadUsers().find(x=>x.usuario===us);
    if(!user||user.activo===false||!verifyPass(body.pass||'',user.salt,user.passHash))return json(401,{error:'Usuario o clave incorrectos'});
    json(200,{token:newSession(user.id),user:publicUser(user)});
  });

  // Versión de la app (sin auth): el navegador la consulta para detectar un deploy nuevo
  // y recargarse solo, así nadie queda con una copia vieja cacheada.
  if(u==='/api/version'&&req.method==='GET')return json(200,{v:APP_VER});

  const apiAuth=u.startsWith('/api/');
  const me=userFromReq(req);
  if(apiAuth&&!me)return json(401,{error:'No autorizado'});

  if(u==='/api/logout'&&req.method==='POST'){return json(200,{ok:true});}
  if(u==='/api/me'&&req.method==='GET')return json(200,{user:publicUser(me)});
  if(u==='/api/bot-status'&&req.method==='GET'){if(me.rol!=='admin')return json(403,{error:'Sin permiso'});return json(200,{tokenSet:!!(CFG.telegramToken&&CFG.telegramToken.length>10),allowedChatId:CFG.allowedChatId||null,lastOkSecondsAgo:botLastOk?Math.round((Date.now()-botLastOk)/1000):null,lastErr:botLastErr||''});}
  if(u==='/api/tg/code'&&req.method==='POST')return json(200,{code:genTgCode(me.id),bot:botUsername||CFG.telegramBotUser});
  if(u==='/api/push/pubkey'&&req.method==='GET')return json(200,{key:pushPubKey(),enabled:!!webpush});
  if(u==='/api/push/subscribe'&&req.method==='POST')return readBody(b=>{const ok=addPushSub(me.id,b.subscription);json(ok?200:400,{ok});});
  if(u==='/api/push/unsubscribe'&&req.method==='POST')return readBody(b=>{removePushSub(me.id,b.endpoint||'');json(200,{ok:true});});

  // Inventario y Financieras (lectura para todos; escritura solo admin/supervisor/dueño)
  const esAdminRol=!!me&&(me.rol==='admin'||me.rol==='supervisor'||me.rol==='dueno');
  if(u==='/api/inventario'&&req.method==='GET')return json(200,loadInventario()||DEFAULT_INVENTARIO);
  if(u==='/api/inventario'&&req.method==='POST'){if(!esAdminRol)return json(403,{error:'Sin permiso'});return readBody(b=>{if(!Array.isArray(b))return json(400,{error:'formato'});saveInventario(b);json(200,{ok:true});});}
  if(u==='/api/financieras'&&req.method==='GET')return json(200,loadFinancieras()||DEFAULT_FINANCIERAS);
  if(u==='/api/financieras'&&req.method==='POST'){if(!esAdminRol)return json(403,{error:'Sin permiso'});return readBody(b=>{if(!Array.isArray(b))return json(400,{error:'formato'});saveFinancieras(b);json(200,{ok:true});});}
  /* ---- Asistente de WhatsApp (admin/supervisor/dueño) ---- */
  if(u==='/api/asistente/config'&&req.method==='GET'){
    if(!esAdminRol)return json(403,{error:'Sin permiso'});
    return json(200,{cfg:ASIS.cargarCfg(),campos:ASIS.CAMPOS,minCampos:ASIS.MIN_CAMPOS,numeroListo:WA_LISTO,iaListo:!!(CFG.geminiKey&&CFG.geminiKey.length>10)});
  }
  if(u==='/api/asistente/config'&&req.method==='POST'){
    if(!esAdminRol)return json(403,{error:'Sin permiso'});
    return readBody(b=>json(200,{cfg:ASIS.guardarCfg(b||{})}));
  }
  // Simulador: Octa escribe como si fuera el cliente y ve qué contestaría.
  // No toca clientes.json — el "cliente" de prueba va y vuelve en el body.
  if(u==='/api/asistente/sim'&&req.method==='POST'){
    if(!esAdminRol)return json(403,{error:'Sin permiso'});
    return readBody(async b=>{
      try{
        const cfg=Object.assign(ASIS.cargarCfg(),b.cfg||{});
        const c=b.cliente&&typeof b.cliente==='object'?b.cliente:{};
        c.id=c.id||'sim';c.nombre=c.nombre||'Cliente de prueba';c.whatsapp=c.whatsapp||'+10000000000';
        c.origen=c.origen||'ad';c.mensajes=Array.isArray(c.mensajes)?c.mensajes:[];
        c.asis=c.asis||{datos:{},msgs:0,estado:'activo'};
        const texto=String(b.texto||'').slice(0,1500);
        if(!texto)return json(400,{error:'texto'});
        c.mensajes.push({de:'cliente',fecha:hoy(),hora:ahora(),texto,canal:'whatsapp'});
        const t0=Date.now();
        const res=await ASIS.responder({cliente:c,texto,cfg,inventario:loadInventario()||DEFAULT_INVENTARIO,financieras:loadFinancieras()||DEFAULT_FINANCIERAS});
        res.mensajes.forEach(m=>c.mensajes.push({de:'yo',fecha:hoy(),hora:ahora(),texto:m,canal:'whatsapp',bot:true}));
        if(res.handoff)c.asis.estado='handoff';
        json(200,{cliente:c,res,ms:Date.now()-t0,filtro:ASIS.estadoFiltro(c)});
      }catch(e){json(500,{error:e.message});}
    });
  }
  if(u==='/api/ordenes'&&req.method==='GET')return json(200,loadOrdenes()||[]);
  if(u==='/api/ordenes'&&req.method==='POST'){if(!esAdminRol)return json(403,{error:'Sin permiso'});return readBody(b=>{if(!Array.isArray(b))return json(400,{error:'formato'});const cur=loadOrdenes()||[];const byId={};cur.forEach(o=>{if(o&&o.id)byId[o.id]=o;});b.forEach(o=>{if(o&&o.id)byId[o.id]=o;});saveOrdenes(Object.values(byId));json(200,{ok:true});});}
  if(u==='/api/seq'&&req.method==='POST'){if(!me)return json(401,{error:'auth'});return readBody(b=>{const name=String(b&&b.name||'').replace(/[^a-z]/gi,'')||'x';json(200,{n:nextSeq(name)});});}
  if(u==='/api/auditoria'&&req.method==='GET'){if(!esAdminRol)return json(403,{error:'Sin permiso'});return json(200,loadAud().slice(-8000));}
  if(u==='/api/auditoria'&&req.method==='POST'){if(!me)return json(401,{error:'auth'});return readBody(b=>{const a=loadAud();
    const e={id:'a'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),ts:new Date().toISOString(),userId:me.id,userName:me.nombre||'',email:me.email||'',rol:me.rol||'',sede:me.sede||'',modulo:String(b.modulo||''),entidad:String(b.entidad||''),accion:String(b.accion||''),referencia:String(b.referencia||''),metodo:String(b.metodo||''),resultado:String(b.resultado||'OK'),cambios:Number(b.cambios)||0,detalle:(b.detalle!=null?b.detalle:'')};
    a.push(e);if(a.length>20000)a.splice(0,a.length-20000);saveAud(a);json(200,{ok:true});});}

  // Actualizar un cliente/venta completo: admin/supervisor/dueño (editar ventas, acreditar pagos, fondeo)
  if(u==='/api/cliente-delete'&&req.method==='POST'){
    if(!me||me.rol!=='admin')return json(403,{error:'Solo admin'});
    return readBody(b=>{if(!b||!b.id)return json(400,{error:'id'});const arr=loadClientes();const i=arr.findIndex(x=>x.id===b.id);if(i>=0){arr.splice(i,1);saveClientes(arr);}json(200,{ok:true});});
  }
  if(u==='/api/cliente-save'&&req.method==='POST'){
    if(!esAdminRol)return json(403,{error:'Sin permiso'});
    return readBody(b=>{
      if(!b||!b.cliente||!b.cliente.id)return json(400,{error:'cliente'});
      const arr=loadClientes();const i=arr.findIndex(x=>x.id===b.cliente.id);
      if(i<0)arr.push(b.cliente);else arr[i]=b.cliente; // upsert: permite crear ventas nuevas a admin/supervisor/dueño
      saveClientes(arr);json(200,{ok:true});
    });
  }
  // Seguimiento de un cliente: admin/supervisor/dueño pueden escribirlo aunque sean solo-lectura del resto
  if(u==='/api/cliente-seg'&&req.method==='POST'){
    if(!esAdminRol)return json(403,{error:'Sin permiso'});
    return readBody(b=>{
      if(!b||!b.id)return json(400,{error:'id'});
      const arr=loadClientes();const c=arr.find(x=>x.id===b.id);if(!c)return json(404,{error:'no existe'});
      c.seg=Array.isArray(b.seg)?b.seg.slice(0,500):[];
      saveClientes(arr);json(200,{ok:true});
    });
  }

  // Importar inventario desde un archivo (PDF / Excel / CSV / foto) usando IA
  if(u==='/api/import-inventario'&&req.method==='POST'){
    if(!esAdminRol)return json(403,{error:'Sin permiso'});
    if(!CFG.geminiKey||CFG.geminiKey.length<10)return json(200,{ok:false,reason:'La IA no está configurada.'});
    return readBody(b=>{
      const prompt='Este archivo es una LISTA DE PRECIOS de una concesionaria (vende motos, triciclos y kits solares/ecoflows). Extraé TODOS los productos con su precio de venta. Respondé SOLO un JSON array; cada item {"nombre":"","cat":"","precio":0,"color":""}. "cat" debe ser exactamente "moto" (cualquier moto: 250cc, 200cc, 150/125/100, eléctricas), "triciclo", o "kit" (kits solares, ecoflows, baterías, inversores, paneles). "precio"=número entero (precio de venta, sin símbolos). "color"="" si no se especifica. No inventes productos que no estén en el archivo.';
      let parts;
      if(b.text){parts=[{text:prompt+'\n\nContenido del archivo:\n'+String(b.text).slice(0,60000)}];}
      else if(b.data){parts=[{text:prompt},{inline_data:{mime_type:b.mime||'application/pdf',data:b.data}}];}
      else return json(400,{error:'sin archivo'});
      geminiChain(parts).then(rv=>{
        if(!rv||!rv.ok||!rv.text){return json(200,{ok:false,reason:rv&&rv.reason==='overload'?'⏳ La IA está saturada, probá de nuevo en unos segundos.':'No pude leer el archivo. Probá con un PDF, Excel/CSV o una foto nítida.'});}
        let arr=null;try{arr=JSON.parse(rv.text);}catch(e){try{arr=JSON.parse(String(rv.text).replace(/```json/gi,'').replace(/```/g,'').trim());}catch(e2){}}
        if(!Array.isArray(arr))return json(200,{ok:false,reason:'No pude interpretar la lista de productos.'});
        const clean=arr.map(p=>({nombre:String(p.nombre||'').trim(),cat:['moto','triciclo','kit'].indexOf(p.cat)>=0?p.cat:'moto',precio:Math.round(Number(p.precio)||0),color:String(p.color||'').trim()})).filter(p=>p.nombre).slice(0,500);
        json(200,{ok:true,productos:clean});
      }).catch(()=>json(200,{ok:false,reason:'Error procesando el archivo.'}));
    });
  }

  // Escaneo de documento (licencia / carnet cubano) con Gemini Vision → autocompleta datos
  if(u==='/api/scan-doc'&&req.method==='POST')return readBody(b=>{
    if(!CFG.geminiKey||CFG.geminiKey.length<10)return json(200,{ok:false,reason:'La IA no está configurada.'});
    const imgs=(b.images||[]).filter(x=>x&&x.data).slice(0,2);
    if(!imgs.length)return json(400,{error:'sin imagen'});
    const cubano=b.tipo==='cubano';
    const prompt=cubano
      ? 'Estas son fotos de un documento de identidad cubano (carnet de identidad) u otro documento de la persona. Extraé TODOS los datos posibles. Respondé SOLO un objeto JSON con estas claves exactas (usá string vacío "" si el dato no se ve): {"nombre":"","apellido":"","carnet":"","telefono":"","direccion":"","municipio":"","provincia":""}. "nombre"=nombre(s) de pila, "apellido"=apellido(s), "carnet"=número de identidad (NI, 11 dígitos), "telefono"=teléfono si aparece, "direccion"=calle y número del domicilio, "municipio"=municipio, "provincia"=provincia de Cuba (ej: La Habana, Santiago de Cuba, Holguín). No inventes datos que no estén en la imagen.'
      : 'Estas son fotos (frente y dorso) de una licencia de conducir de Estados Unidos. Extraé los datos del titular. Respondé SOLO un objeto JSON con estas claves exactas (usá string vacío "" si el dato no se ve): {"nombre":"","apellido":"","direccion":"","apt":"","ciudad":"","estado":"","codigoPostal":""}. "nombre"=first name, "apellido"=last name, "direccion"=número y calle (street address, sin apt), "apt"=número de apartamento/unidad si hay, "ciudad"=city, "estado"=state en 2 letras (ej FL), "codigoPostal"=ZIP code (5 dígitos). No inventes datos que no estén en la imagen.';
    geminiVision(imgs,prompt).then(rv=>{
      if(!rv||!rv.ok||!rv.text){
        const reason=(rv&&rv.reason==='overload')
          ? '⏳ La IA está con mucha demanda ahora. Esperá unos segundos y tocá Escanear otra vez.'
          : 'No pude leer el documento. Probá con fotos más nítidas o cargá los datos a mano.';
        return json(200,{ok:false,reason});
      }
      const raw=rv.text;
      let data=null;
      try{data=JSON.parse(raw);}catch(e){try{data=JSON.parse(String(raw).replace(/```json/gi,'').replace(/```/g,'').trim());}catch(e2){data=null;}}
      if(!data||typeof data!=='object')return json(200,{ok:false,reason:'No pude interpretar el documento. Cargá los datos a mano.'});
      const clean=k=>String(data[k]==null?'':data[k]).trim();
      json(200,{ok:true,data:{nombre:clean('nombre'),apellido:clean('apellido'),carnet:clean('carnet'),telefono:clean('telefono'),direccion:clean('direccion'),apt:clean('apt'),ciudad:clean('ciudad'),estado:clean('estado'),codigoPostal:clean('codigoPostal'),municipio:clean('municipio'),provincia:clean('provincia')}});
    }).catch(()=>json(200,{ok:false,reason:'Error escaneando el documento.'}));
  });

  // Guardar la foto de un documento de venta (licencia / carnet) como archivo
  if(u==='/api/venta-doc'&&req.method==='POST')return readBody(b=>{
    if(!b||!b.data)return json(400,{error:'sin imagen'});
    try{
      const buf=Buffer.from(String(b.data),'base64');
      if(!buf.length||buf.length>6*1024*1024)return json(413,{error:'tamaño inválido'});
      const id=crypto.randomBytes(12).toString('hex')+'.jpg';
      fs.writeFileSync(path.join(VDOCS,id),buf);
      json(200,{ok:true,id});
    }catch(e){json(500,{error:'no se pudo guardar'});}
  });
  // Servir la foto de un documento (requiere sesión — es info sensible)
  if(u==='/api/vdoc'&&req.method==='GET'){
    const qp=new URLSearchParams(req.url.split('?')[1]||'');
    const id=String(qp.get('id')||'');
    if(!/^[a-f0-9]{24}\.jpg$/.test(id))return json(400,{error:'id'});
    try{const buf=fs.readFileSync(path.join(VDOCS,id));res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=86400'});return res.end(buf);}catch(e){res.writeHead(404);return res.end('no');}
  }

  if(u==='/api/push/test'&&req.method==='POST'){
    if(!webpush)return json(200,{ok:false,reason:'El servidor no tiene el push habilitado.'});
    const uu=loadUsers().find(x=>x.id===me.id),subs=(uu&&uu.pushSubs)||[];
    if(!subs.length)return json(200,{ok:false,reason:'Este dispositivo no está suscripto. Tocá "Activar en este teléfono" primero.',subs:0});
    return Promise.all(subs.map(s=>webpush.sendNotification(s,JSON.stringify({title:'Riders CRM',body:'✅ Notificación de prueba — ¡funciona!'})).then(()=>({ok:true})).catch(e=>({ok:false,code:e&&e.statusCode,msg:((e&&(e.body||e.message))||'').toString().slice(0,140)})))).then(rs=>{const okc=rs.filter(r=>r.ok).length;json(200,{ok:okc>0,subs:subs.length,enviadas:okc,errores:rs.filter(r=>!r.ok)});}).catch(e=>json(200,{ok:false,reason:e.message}));
  }
  if(u==='/api/tg/unlink'&&req.method==='POST'){const users=loadUsers();const usr=users.find(x=>x.id===me.id);if(usr){delete usr.telegramChatId;saveUsers(users);}return json(200,{ok:true});}

  // ¿Ya existe un cliente con este número (de cualquier vendedor)? Devuelve quién lo tiene.
  if(u==='/api/clientes/check'&&req.method==='GET'){
    const wa=new URLSearchParams(req.url.split('?')[1]||'').get('wa')||'';
    const d=wa.replace(/\D/g,'');
    if(d.length<7)return json(200,{exists:false});
    const match=loadClientes().find(c=>{if(c.borrado||c.descartado)return false;const cd=String(c.whatsapp||'').replace(/\D/g,'');return cd.length>=7&&(cd.endsWith(d)||d.endsWith(cd));});
    if(!match)return json(200,{exists:false});
    const owner=loadUsers().find(x=>x.id===match.vendedorId);
    return json(200,{exists:true,mismo:match.vendedorId===me.id,vendedor:owner?owner.nombre:'—',cliente:match.nombre});
  }
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
    if(typeof body.apellido==='string')target.apellido=body.apellido.trim();
    if(typeof body.telefono==='string')target.telefono=body.telefono.trim();
    if(typeof body.email==='string')target.email=body.email.trim();
    if(body.usuario){const us=String(body.usuario).trim().toLowerCase();if(us&&us!==target.usuario){if(!/^[\w.]{3,}$/.test(us))return json(400,{error:'Usuario inválido (mín 3, letras/números)'});if(users.some(x=>x.usuario===us&&x.id!==target.id))return json(400,{error:'Ese usuario ya existe'});target.usuario=us;}}
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
  if(/(users|clientes|config)\.json$/i.test(fp)||/backups/i.test(fp)||/\.secret$/i.test(fp)){res.writeHead(403);return res.end('no');}
  const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
  fs.readFile(fp,(e,d)=>{if(e){res.writeHead(404);res.end('not found')}else{const ext=path.extname(fp).toLowerCase();res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',MIME[ext]||'text/plain; charset=utf-8');res.end(d)}});
}).listen(process.env.PORT||CFG.port,()=>{
  console.log('CRM en http://localhost:'+CFG.port);
  console.log('Cerebro: '+((CFG.geminiKey&&CFG.geminiKey.length>10)?'Gemini IA':'Parser simple (sin clave de Gemini todavía)'));
  console.log('Bot de Telegram escuchando...');
  // Migración: ningún cliente queda sin fecha de próximo contacto → los sin fecha se agendan para hoy.
  try{const _cs=loadClientes();let _ch=0;const _h=hoy();_cs.forEach(c=>{if(!c.proximo&&!c.borrado&&!c.descartado){c.proximo=_h;if(!c.proximoTipo)c.proximoTipo='Seguimiento';_ch++;}});if(_ch){saveClientes(_cs);console.log('Migración: '+_ch+' cliente(s) sin fecha → agendados para hoy.');}}catch(e){console.log('[migracion proximo] '+e.message);}
  poll();
  fetchBotUsername();setTimeout(fetchBotUsername,10000); // averigua el @usuario real del bot
  // Copias de seguridad: intenta el backup diario al arrancar y luego cada hora.
  setTimeout(maybeDailyBackup,8000);
  setInterval(maybeDailyBackup,60*60*1000);
  // Recordatorios: revisa cada minuto qué contactos vencen y avisa al vendedor dueño.
  setTimeout(checkDue,12000);
  setInterval(checkDue,60*1000);
});
