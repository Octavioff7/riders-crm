// Importa los clientes de wa-raw.txt a clientes.json (sin duplicar)
const fs=require('fs');
function hoy(){return new Date().toISOString().slice(0,10)}
function uid(){return 'c'+Math.random().toString(36).slice(2,9)}
const clientes=JSON.parse(fs.readFileSync(__dirname+'/clientes.json','utf8'));
const existing=new Set(clientes.map(c=>(c.whatsapp||'').replace(/\D/g,'')).filter(Boolean));
const lines=fs.readFileSync(__dirname+'/wa-raw.txt','utf8').split('\n').map(l=>l.replace(/\r/g,'').trim()).filter(Boolean);
const prod=t=>{t=(t||'').toLowerCase();if(/panel|solar|ecoflow|placa/.test(t))return'Kit solar';if(/tricicl/.test(t))return'Triciclo';if(/moto|nafta|scooter/.test(t))return'Moto';return'Otro';};
const parseVal=t=>{if(!/\$|\d\.\d{3}/.test(t||''))return 0;const m=(t||'').match(/([\d][\d.]*)/);if(!m)return 0;const v=parseInt(m[1].replace(/\./g,''),10)||0;return (v>=500&&v<=100000)?v:0;};
const dateLabel=labels=>{for(const l of labels){const m=l.match(/^(\d{1,2})\/(\d{1,2})$/);if(m)return '2026-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');}return '';};
const junkPrev=p=>!p||/^(photo|sticker|voice call|\d+ photos|audio|ubicación|http|0:\d+)/i.test(p);
let added=0;
for(const line of lines){
  const parts=line.split('|||');
  const name=parts[0], preview=parts[1]||'', labelsStr=parts[2]||'';
  if(!name.startsWith('+'))continue;
  const digits=name.replace(/\D/g,'');
  if(!digits||existing.has(digits))continue;
  existing.add(digits);
  const labels=labelsStr.split(',').map(s=>s.trim()).filter(Boolean);
  const L=labels.join(' ');
  const hot=/🔥/.test(L);
  let etapa='nuevo';
  if(/VENDIDO/i.test(L))etapa='vendido';
  else if(/Presencial|Coordinar/i.test(L))etapa='negociando';
  else if(hot)etapa='negociando';
  else if(/Seguimiento/i.test(L))etapa='interesado';
  else if(/Llamar/i.test(L))etapa='interesado';
  let proximo=dateLabel(labels);
  if(!proximo && /Seguimiento|Llamar/i.test(L))proximo=hoy();
  const cleanLabels=labels.filter(x=>!/^\d{1,2}\/\d{1,2}$/.test(x));
  const notaParts=[];
  if(cleanLabels.length)notaParts.push('🏷️ Etiquetas WhatsApp: '+cleanLabels.join(', ')+'.');
  if(!junkPrev(preview))notaParts.push('💬 Último mensaje: "'+preview+'".');
  if(!notaParts.length)notaParts.push('Importado de WhatsApp (sin actividad reciente).');
  clientes.push({
    id:uid(),nombre:name,whatsapp:name,producto:prod(preview),ubicacion:'',
    etapa,valor:parseVal(preview),proximo,proximoTipo:'',creado:hoy(),ultimoContacto:hoy(),
    respondioUltimo:hot?'cliente':'yo',
    log:[{fecha:hoy(),texto:notaParts.join(' ')}],mensajes:[]
  });
  added++;
}
fs.writeFileSync(__dirname+'/clientes.json',JSON.stringify(clientes,null,1));
console.log('Agregados: '+added+' | Total ahora: '+clientes.length);
