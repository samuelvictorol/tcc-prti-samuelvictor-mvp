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
    expect(nginx).toContain('listen ${PORT};')
    expect(nginx).toContain('proxy_pass http://${API_UPSTREAM};')
    expect(compose).toContain('API_UPSTREAM: api:3000')
    expect(render).toContain('key: API_UPSTREAM')
    expect(render).toContain('property: hostport')
  })
})
