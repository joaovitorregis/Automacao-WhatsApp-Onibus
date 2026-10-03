export function panelModeFrom(args) {
  const panel=args.filter(arg=>arg==='--panel-check' || arg==='--panel-pair');
  if(!panel.length) return false;
  if(panel.length!==1 || args.length!==1) throw Error('Modo do painel nao permite argumentos de envio ou outros modos');
  return true;
}
