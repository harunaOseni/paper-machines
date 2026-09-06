/** Explicit origins only: no credentials, paths, queries or wildcards. */
export function parseOrigin(value) {
  let url;
  try { url=new URL(value); } catch { throw new Error('Expected an absolute HTTP(S) origin'); }
  if(!['http:','https:'].includes(url.protocol)||url.hostname.includes('*')||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Expected an origin without credentials, wildcard, path, query or fragment');
  if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Public origins must use HTTPS');
  return url.origin;
}
export function deploymentConfig(env) {
  const production=env.NODE_ENV==='production';
  const origins=env.ALLOWED_ORIGINS?.split(',').map(s=>s.trim()).filter(Boolean).map(parseOrigin)??[];
  if(production&&!origins.length)throw new Error('ALLOWED_ORIGINS is required in production');
  const port=Number(env.PORT??4173);
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid PORT');
  return {host:env.HOST||(production?'0.0.0.0':'127.0.0.1'),port,
    allowedOrigins:origins.length?origins:null,
    apiOrigin:env.PUBLIC_API_ORIGIN?parseOrigin(env.PUBLIC_API_ORIGIN):''};
}
export function publicConfigSource(apiOrigin) {
  return `// Public routing configuration only. Never include credentials here.\nexport const API_ORIGIN = ${JSON.stringify(apiOrigin)};\n`;
}
