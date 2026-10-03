export function resolveGroup(groups, name, id) {
  const matches = groups.filter(group => id ? group.id === id && group.subject === name : group.subject === name);
  if (matches.length !== 1) throw Error('Grupo ausente, renomeado ou ambiguo; selecione novamente no painel');
  return matches[0];
}
