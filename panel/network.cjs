'use strict';
const net=require('node:net');
function configuredRun(source,host,port) {
  const octets=String(host).split('.').map(Number);
  const privateIp=net.isIP(host || '')===4 && (octets[0]===10 || octets[0]===127 || (octets[0]===192 && octets[1]===168) || (octets[0]===172 && octets[1]>=16 && octets[1]<=31) || (octets[0]===100 && octets[1]>=64 && octets[1]<=127));
  const privateName=typeof host==='string' && (/^[a-zA-Z][a-zA-Z0-9-]{0,62}$/.test(host) || /^[a-zA-Z0-9.-]+\.ts\.net$/.test(host));
  const number=Number(port);
  if((!privateIp && !privateName) || !Number.isInteger(number) || number<1 || number>65535) throw Error('Informe endereço privado e porta válidos para o painel');
  if(!source.startsWith('#!')) throw Error('Script de serviço inválido');
  const clean=source.replace(/^export PANEL_(HOST|PORT)=.*\r?\n/gm,'');
  const end=clean.indexOf('\n');
  if(end<0) throw Error('Script de serviço inválido');
  return clean.slice(0,end+1)+`export PANEL_HOST="${host}"\nexport PANEL_PORT="${number}"\n`+clean.slice(end+1);
}
module.exports={configuredRun};
