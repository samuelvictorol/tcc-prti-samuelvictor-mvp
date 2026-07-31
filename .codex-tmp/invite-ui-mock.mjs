import http from 'node:http'

const invite = {
  active: true,
  title: 'Grupo Alpha',
  description: 'Autorize as notificações iniciando uma conversa conosco clicando nos botões abaixo.',
  gradientStart: '#dfbd8d',
  gradientEnd: '#789bda',
  links: [
    {
      id: 'whatsapp',
      channel: 'whatsapp_cloud',
      label: 'Autorizar WhatsApp',
      trackingUrl: 'https://wa.me/5511999999999?text=%2Fnotify-me',
    },
    {
      id: 'telegram',
      channel: 'telegram',
      label: 'Iniciar Telegram',
      trackingUrl: 'https://t.me/NotifyFlowBot?start=grupo-alpha',
    },
  ],
}

const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  if (request.url?.startsWith('/api/public/invites/grupo-alpha')) {
    response.end(JSON.stringify({ data: invite }))
    return
  }
  if (request.url?.startsWith('/api/public/terms/')) {
    const type = request.url.split('/').pop()
    response.end(JSON.stringify({ data: { type, title: 'Documento legal', content: '<p>Conteúdo de validação visual.</p>' } }))
    return
  }
  response.statusCode = 404
  response.end(JSON.stringify({ error: { message: 'Não encontrado' } }))
})

server.listen(3000, '127.0.0.1')
