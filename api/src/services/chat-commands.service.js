const FIXED_CHAT_COMMANDS = Object.freeze({
  help: '/help',
  login: '/login',
  profile: '/meu-perfil',
  cancelEmail: '/cancelar',
  telegramStart: '/start',
  telegramStop: '/stop'
});

function permissionCommand(value, fallback) {
  const command = String(value || fallback || '').normalize('NFKC').trim();
  return command.startsWith('/') ? command : `/${command}`;
}

function commandEntry(command, title, description, options = {}) {
  return Object.freeze({
    command,
    title,
    description,
    dynamic: Boolean(options.dynamic)
  });
}

function whatsappCommands(permissionCommands = {}) {
  const whatsapp = permissionCommand(permissionCommands.whatsapp, '/notify-me');
  return [
    commandEntry(
      whatsapp,
      'Autorizar notificações',
      'Autoriza o WhatsApp oficial e registra a origem do consentimento.',
      { dynamic: true }
    ),
    commandEntry(
      FIXED_CHAT_COMMANDS.login,
      'Entrar no Meu perfil',
      'Gera um link pessoal, temporário e de uso único.'
    ),
    commandEntry(
      FIXED_CHAT_COMMANDS.profile,
      'Consultar meus dados',
      'Mostra um resumo do cadastro, das permissões e o acesso para edição.'
    ),
    commandEntry(
      FIXED_CHAT_COMMANDS.help,
      'Ver esta ajuda',
      'Lista novamente os comandos disponíveis nesta conversa.'
    ),
    commandEntry(
      FIXED_CHAT_COMMANDS.cancelEmail,
      'Cancelar alteração de email',
      'Interrompe uma verificação de email em andamento sem alterar o cadastro.'
    )
  ];
}

function telegramCommands(permissionCommands = {}) {
  const whatsapp = permissionCommand(permissionCommands.whatsapp, '/notify-me');
  const telegram = permissionCommand(permissionCommands.telegram, '/verify-me');
  const commands = [
    commandEntry(
      telegram,
      'Autorizar o Telegram',
      'Autoriza as notificações e abre o menu de vínculo, perfil e ajuda.',
      { dynamic: true }
    )
  ];
  if (whatsapp !== telegram) {
    commands.push(commandEntry(
      whatsapp,
      'Autorizar pelo comando do convite',
      'O comando dinâmico do WhatsApp também abre o onboarding no Telegram.',
      { dynamic: true }
    ));
  }
  commands.push(
    commandEntry(
      FIXED_CHAT_COMMANDS.telegramStart,
      'Iniciar o bot',
      'Inicia a conversa. Quando aberto por um convite, o link inclui automaticamente o vínculo correto.'
    ),
    commandEntry(
      FIXED_CHAT_COMMANDS.login,
      'Entrar no Meu perfil',
      'Gera um link pessoal, temporário e de uso único.'
    ),
    commandEntry(
      FIXED_CHAT_COMMANDS.profile,
      'Consultar meus dados',
      'Mostra um resumo do cadastro, das permissões e o acesso para edição.'
    ),
    commandEntry(
      FIXED_CHAT_COMMANDS.help,
      'Ver esta ajuda',
      'Lista novamente os comandos disponíveis nesta conversa.'
    ),
    commandEntry(
      FIXED_CHAT_COMMANDS.cancelEmail,
      'Cancelar alteração de email',
      'Interrompe uma verificação de email em andamento sem alterar o cadastro.'
    ),
    commandEntry(
      FIXED_CHAT_COMMANDS.telegramStop,
      'Revogar o Telegram',
      'Desativa a permissão deste canal até uma nova autorização explícita.'
    )
  );
  return commands;
}

function commandCatalog(channel, permissionCommands = {}) {
  if (channel === 'whatsapp_cloud') return whatsappCommands(permissionCommands);
  if (channel === 'telegram') return telegramCommands(permissionCommands);
  return [];
}

function helpMessage(channel, permissionCommands = {}) {
  const telegram = channel === 'telegram';
  const heading = telegram ? 'Telegram' : 'WhatsApp';
  const lines = commandCatalog(channel, permissionCommands)
    .map((item) => `${item.command} — ${item.description}`);
  const emailNote = telegram
    ? 'Email: envie um único endereço válido no chat. O código de confirmação chegará nesse email e deve ser respondido aqui.'
    : 'Email: envie um único endereço válido nesta conversa. O código de confirmação chegará nesse email e deve ser respondido aqui.';
  return [
    `Ajuda do Notify Flow no ${heading}`,
    '',
    ...lines,
    '',
    emailNote,
    '',
    'Por segurança, use somente os links de convite e login gerados pelo Notify Flow.'
  ].join('\n');
}

module.exports = {
  FIXED_CHAT_COMMANDS,
  commandCatalog,
  helpMessage
};
