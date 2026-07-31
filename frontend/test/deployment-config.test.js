import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function rootFile(relativePath) {
  return readFileSync(
    fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)),
    'utf8',
  )
}

describe('configuração de deploy do frontend', () => {
  it('resolve a API em runtime no Compose e na rede privada do Render', () => {
    const dockerfile = rootFile('frontend/Dockerfile')
    const nginx = rootFile('frontend/nginx.conf')
    const normalizeUpstream = rootFile(
      'frontend/docker-entrypoint.d/16-normalize-api-upstream.envsh',
    )
    const compose = rootFile('docker-compose.yml')
    const render = rootFile('render.yaml')

    expect(dockerfile).toContain('/etc/nginx/templates/default.conf.template')
    expect(dockerfile).toContain('NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1')
    expect(dockerfile).toContain(
      'docker-entrypoint.d/16-normalize-api-upstream.envsh',
    )
    expect(normalizeUpstream).toContain('/etc/resolv.conf')
    expect(normalizeUpstream).toContain('api_host="${api_host}.${api_search_domain}"')
    expect(normalizeUpstream).toContain('export API_UPSTREAM')
    expect(nginx).toContain('listen ${PORT};')
    expect(nginx).toContain('resolver ${NGINX_LOCAL_RESOLVERS} valid=30s ipv6=off;')
    expect(nginx).toContain('set $api_upstream "${API_UPSTREAM}";')
    expect(nginx.match(/proxy_pass http:\/\/\$api_upstream;/g)).toHaveLength(4)
    expect(nginx).toContain('location = /api/media {')
    expect(nginx).toContain('location ^~ /api/media/')
    expect(nginx).toContain('access_log off;')
    expect(nginx).not.toContain('proxy_pass http://${API_UPSTREAM};')
    expect(compose).toContain('API_UPSTREAM: api:3000')
    expect(render).toContain('key: API_UPSTREAM')
    expect(render).toContain('property: hostport')
    expect(render).toContain('healthCheckPath: /healthz')
    expect(render.match(/^\s+region:\s+oregon\s*$/gm)).toHaveLength(3)
  })

  it('usa somente os menores planos pagos e dispensa disco de sessão de navegador', () => {
    const render = rootFile('render.yaml')
    const plans = [...render.matchAll(/^\s+plan:\s+(\S+)\s*$/gm)].map((match) => match[1])
    const apiService = render.match(
      /  - type: pserv\n    name: api\n([\s\S]*?)(?=\n  - type:|\s*$)/,
    )?.[1] || ''

    expect(plans).toEqual(['starter', 'starter', 'starter'])
    expect(render).not.toMatch(/^\s+plan:\s+free\s*$/m)
    expect(apiService).not.toContain('disk:')
    expect(render).not.toContain('.wwebjs_auth')
    expect(render).not.toContain('PUPPETEER_EXECUTABLE_PATH')
  })
})
