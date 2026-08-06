// Extrae los clientes del seed de index.html y los guarda en clientes.json
const fs=require('fs');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const m=html.match(/function seed\(\)\{return (\[[\s\S]*?\]);\}/);
if(!m){console.error('No encontré el seed en index.html');process.exit(1);}
function uid(){return 'c'+Math.random().toString(36).slice(2,9);}
function hoy(){return new Date().toISOString().slice(0,10);}
function daysAgo(n){const d=new Date();d.setDate(d.getDate()-n);return d.toISOString().slice(0,10);}
function daysAhead(n){const d=new Date();d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);}
const arr=eval(m[1]);
arr.forEach(c=>{c.mensajes=c.mensajes||[];c.log=c.log||[];});
fs.writeFileSync(__dirname+'/clientes.json',JSON.stringify(arr,null,1));
console.log('clientes.json creado con '+arr.length+' clientes');
