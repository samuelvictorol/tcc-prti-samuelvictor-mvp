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
    const compose = rootFile('docker-compose.yml')
    const render = rootFile('render.yaml')

    expect(dockerfile).toContain('/etc/nginx/templates/default.conf.template')
    expect(dockerfile).toContain('NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1')
    expect(nginx).toContain('listen ${PORT};')
    expect(nginx).toContain('resolver ${NGINX_LOCAL_RESOLVERS} valid=30s ipv6=off;')
    expect(nginx).toContain('set $api_upstream "${API_UPSTREAM}";')
    expect(nginx.match(/proxy_pass http:\/\/\$api_upstream;/g)).toHaveLength(2)
    expect(nginx).not.toContain('proxy_pass http://${API_UPSTREAM};')
    expect(compose).toContain('API_UPSTREAM: api:3000')
    expect(render).toContain('key: API_UPSTREAM')
    expect(render).toContain('property: hostport')
  })

  it('usa somente os menores planos pagos e nao combina shutdown customizado com disco', () => {
    const render = rootFile('render.yaml')
    const plans = [...render.matchAll(/^\s+plan:\s+(\S+)\s*$/gm)].map((match) => match[1])
    const apiService = render.match(
      /  - type: pserv\n    name: api\n([\s\S]*?)(?=\n  - type:|\s*$)/,
    )?.[1] || ''

    expect(plans).toEqual(['starter', 'starter', 'starter'])
    expect(render).not.toMatch(/^\s+plan:\s+free\s*$/m)
    expect(apiService).toContain('disk:')
    expect(apiService).not.toContain('maxShutdownDelaySeconds')
  })
})
