const INITIAL_LEGAL_VERSION = 'preconfigured-1';

const DEFAULT_LEGAL_DOCUMENTS = Object.freeze([
  Object.freeze({
    type: 'terms_of_use',
    title: 'Termos de Uso',
    content: `
      <h2>1. Sobre estes termos</h2>
      <p>Estes Termos de Uso explicam as regras para utilizar o serviço de cadastro, convites, preferências e notificações por canais digitais. Ao utilizar o serviço, você declara que leu estes termos e que fornecerá informações verdadeiras e atualizadas.</p>

      <h2>2. Cadastro e identificação</h2>
      <p>Para reconhecer você e entregar as comunicações solicitadas, o serviço pode utilizar seu nome, telefone, e-mail, foto de perfil disponibilizada pelo canal e identificadores vinculados às suas contas de Telegram, WhatsApp ou e-mail. Quando identidades de canais diferentes puderem ser confirmadas como pertencentes à mesma pessoa, elas poderão ser reunidas em um único cadastro para evitar duplicidade.</p>

      <h2>3. Autorizações e preferências</h2>
      <p>As permissões podem ser consultadas e desativadas separadamente. A ativação depende de uma ação sua, como iniciar uma conversa, enviar o comando indicado, compartilhar o telefone no Telegram ou confirmar uma preferência. No WhatsApp, o comando de autorização pode habilitar as integrações Web e Cloud associadas ao mesmo número; depois disso, cada permissão continua disponível separadamente para ajuste ou revogação. Você pode recusar ou revogar uma autorização a qualquer momento pelos recursos disponibilizados no serviço ou pelo próprio canal.</p>

      <h2>4. Uso adequado</h2>
      <p>Você não deve tentar acessar dados de terceiros, fraudar confirmações, prejudicar o funcionamento do serviço ou utilizar convites e canais para fins ilícitos. Também é sua responsabilidade proteger o acesso ao seu e-mail, telefone e contas dos provedores utilizados.</p>

      <h2>5. Disponibilidade e canais externos</h2>
      <p>A entrega de mensagens depende da disponibilidade e das regras do canal escolhido. Telegram, Meta, WhatsApp e Google/Gmail possuem termos e políticas próprios, que também se aplicam quando seus serviços são utilizados. Configurações do aparelho ou do provedor, bloqueios, indisponibilidades e limites externos podem impedir ou atrasar uma entrega.</p>

      <h2>6. Atualizações e atendimento</h2>
      <p>Estes termos podem ser atualizados para refletir mudanças no serviço ou em obrigações aplicáveis. A versão vigente ficará disponível para consulta. Dúvidas e solicitações podem ser encaminhadas pelos meios de contato apresentados no serviço ou no convite pelo qual você chegou.</p>
    `
  }),
  Object.freeze({
    type: 'privacy_policy',
    title: 'Política de Privacidade',
    content: `
      <h2>1. Dados que podem ser utilizados</h2>
      <p>Conforme os recursos que você utilizar, podem ser tratados dados de identificação e contato, como nome, telefone, e-mail e foto de perfil; identificadores fornecidos pelos canais, como identificadores de usuário, conversa ou conta; autorizações, recusas e alterações de preferência; mensagens trocadas com os canais conectados; registros de envio, recebimento, falha e tentativa de entrega; informações de convites acessados; e registros necessários à segurança, autenticação e prevenção de uso indevido.</p>

      <h2>2. Para que os dados são utilizados</h2>
      <p>Os dados são utilizados para identificar você, evitar cadastros duplicados, permitir o acesso ao seu perfil, manter suas preferências, entregar notificações solicitadas, apresentar o histórico relacionado às suas comunicações, atender pedidos sobre seus dados, proteger contas e demonstrar o funcionamento e a entrega das mensagens.</p>

      <h2>3. Fundamentos do tratamento</h2>
      <p>O tratamento poderá se apoiar no seu consentimento, na execução de funcionalidades solicitadas por você, no cumprimento de obrigações legais ou regulatórias, no exercício regular de direitos e, quando aplicável, em interesses legítimos avaliados com respeito aos seus direitos e expectativas. A revogação do consentimento não afeta tratamentos anteriores realizados de forma válida nem tratamentos amparados por outro fundamento legal.</p>

      <h2>4. Compartilhamento e provedores</h2>
      <p>Os dados são compartilhados somente na medida necessária para utilizar o canal escolhido. Isso pode envolver Telegram, Meta e WhatsApp para mensagens nesses canais, e Google/Gmail para comunicações por e-mail. Esses provedores também tratam dados segundo suas próprias políticas e podem realizar processamento em outros países. Não comercializamos seus dados pessoais.</p>

      <h2>5. Retenção e segurança</h2>
      <p>Os dados são mantidos pelo período necessário às finalidades informadas, ao atendimento de obrigações aplicáveis, à segurança e ao exercício de direitos. São adotadas medidas razoáveis para limitar acessos indevidos e proteger os registros, sem que seja possível garantir risco zero em transmissões e serviços externos. Dados podem ser eliminados ou anonimizados quando deixarem de ser necessários, observadas hipóteses legais de conservação.</p>

      <h2>6. Seus direitos</h2>
      <p>Nos termos da LGPD, você pode solicitar confirmação e acesso ao tratamento, correção de dados incompletos ou incorretos, informação sobre compartilhamentos, portabilidade quando aplicável, anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade, revisão das suas preferências e revogação do consentimento. Algumas solicitações podem exigir confirmação de identidade.</p>

      <h2>7. Como exercer seus direitos</h2>
      <p>Use os controles disponíveis em “Meu perfil” para consultar ou alterar dados e preferências. Você também pode utilizar os meios de contato apresentados no serviço ou no convite. A desativação de um canal interrompe novos envios autorizados por essa preferência, respeitadas obrigações de conservação aplicáveis.</p>
    `
  }),
  Object.freeze({
    type: 'terms_of_service',
    title: 'Termos de Serviço e Comunicações',
    content: `
      <h2>1. Comunicações oferecidas</h2>
      <p>O serviço permite receber notificações e mensagens transacionais pelos canais que você escolher, inclusive Telegram, WhatsApp e e-mail. O conteúdo e a frequência dependem das comunicações configuradas para você ou para os grupos dos quais você faça parte.</p>

      <h2>2. Como autorizar</h2>
      <p>A autorização exige uma ação afirmativa sua. Ela pode ocorrer ao iniciar a conversa e enviar o comando informado, ao compartilhar o telefone quando solicitado ou ao confirmar uma preferência no seu perfil. No WhatsApp, um único comando pode autorizar as integrações Web e Cloud vinculadas ao mesmo número, mantendo controles separados para alterações futuras. Telegram e e-mail continuam sendo escolhas independentes.</p>

      <h2>3. Cancelamento e alteração de preferências</h2>
      <p>Você pode desativar comunicações por canal no seu perfil ou pelos meios informados no serviço. Solicitações de cancelamento serão respeitadas, sem prejuízo de mensagens estritamente necessárias à segurança, à confirmação de uma solicitação feita por você ou ao cumprimento de obrigação aplicável.</p>

      <h2>4. Entrega e histórico</h2>
      <p>Podem ser mantidos registros de mensagens, tentativas, confirmações e falhas para apresentar seu histórico, verificar entregas e solucionar problemas. Uma mensagem enviada ao provedor pode não gerar aviso no aparelho se suas configurações estiverem silenciadas, se o contato estiver bloqueado ou se o canal estiver indisponível.</p>

      <h2>5. Segurança e códigos de acesso</h2>
      <p>Códigos de verificação são pessoais, temporários e não devem ser compartilhados. Se você não solicitou um código ou suspeita de uso indevido, ignore a mensagem e procure os meios de atendimento exibidos no serviço.</p>

      <h2>6. Regras dos provedores</h2>
      <p>As comunicações também estão sujeitas às políticas do Telegram, da Meta, do WhatsApp e do Google/Gmail, conforme o canal escolhido. Esses provedores podem aplicar limites, bloquear conteúdo ou processar dados de acordo com suas próprias regras, inclusive em outros países.</p>

      <h2>7. Dúvidas</h2>
      <p>Para dúvidas sobre uma comunicação, suas preferências ou seus dados, utilize “Meu perfil” ou os meios de contato apresentados no serviço ou convite.</p>
    `
  })
]);

function listDefaultLegalDocuments() {
  return DEFAULT_LEGAL_DOCUMENTS.map((document) => ({ ...document }));
}

module.exports = { INITIAL_LEGAL_VERSION, listDefaultLegalDocuments };
