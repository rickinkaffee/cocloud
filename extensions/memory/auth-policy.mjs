// Aggregated private history must not be exposed to a thread-scoped guest/share session.
export function allowed(auth,url){
 const scopes=auth.permissions??auth.scopes??[];
 return auth.authenticated===true&&['filesystem:read','orchestration:read','access:write'].every(s=>scopes.includes(s))&&(!['/api/cocloud/memory/control','/api/cocloud/memory/model','/api/cocloud/memory/profile'].some(p=>url.split('?')[0]===p)||scopes.includes('orchestration:operate'));
}
