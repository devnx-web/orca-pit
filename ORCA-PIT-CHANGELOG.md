# Orca-Pit — mudanças

Cada versão é a do Orca em que o fork está + `-pitN`. Instalar a última:

```bash
curl -fsSL https://arquivos.devnx.com.br/orca-pit/install.sh | sudo bash
```

## 1.4.214-pit14 — 30/10/2026

**Máquinas da empresa num endereço só**

- Ao entrar com o login do DevNX Control, o computador se cadastra sozinho
  como máquina da empresa. Depois que um administrador aprova em
  control.devnx.com.br/maquinas, ele fica acessível em
  `orca.devnx.com.br/<nome-da-máquina>`, sem túnel nem subdomínio criado à mão:
  o Orca-Pit baixa e liga sozinho o túnel do Cloudflare.
- Configurações → Servidores mostra as **Máquinas da empresa**: quem é o dono
  (com a foto), se está online, a versão e o botão **Conectar**, que entra com
  o seu login, sem link nem senha.
- O "Endereço deste computador" se preenche sozinho com o endereço da máquina.
- Se a internet cair, a conexão com uma máquina da mesma rede passa a usar o
  endereço local e volta sozinha quando a internet volta.
- O acesso pelo endereço escondido de cada máquina só funciona passando pelo
  `orca.devnx.com.br`: quem tentar entrar direto é recusado.

## 1.4.214-pit13 — 30/10/2026

A barra lateral no agrupamento **Agentes** passa a ser organizada 100% por projeto:

- **Um projeto, um cabeçalho**, mesmo rodando em várias máquinas. "Momento" no
  ftgkNote e no Nitro5 vira um "Momento" só. Projetos ligados ao mesmo projeto
  do DevNX Control também se juntam, e nomes iguais (sem contar maiúsculas e
  acentos) idem.
- A **máquina** sai do cabeçalho e vai para cada agente: aparece quando o agente
  roda em outra máquina, e em todos os agentes de um projeto espalhado por
  mais de uma.
- O **+** de um projeto em várias máquinas pergunta em qual criar o workspace.
- **Projetos com agente ficam no topo**, do agente mais recente para o mais
  antigo, valendo o agente de qualquer pessoa e de qualquer máquina. Antes só
  contava a mensagem enviada deste aparelho, e projetos com agente rodando
  apareciam em "Inativos".
- **Projetos sem agente** descem para "Sem agente agora", recolhido no fim da
  lista; um clique abre. Grupos de projetos vazios somem.
- Num grupo com agentes em dois ou mais projetos, cada projeto aparece embaixo
  do grupo; com um só, os agentes ficam direto no grupo, como antes.
- "Separar ativos e inativos" continua só no agrupamento **Projeto**.

## 1.4.214-pit12 — 30/10/2026

**Cada pessoa entra com o próprio login**

- **Login ao abrir o app:** num computador ligado ao DevNX Control, o Orca-Pit
  abre numa tela de login (e-mail e senha do Control; o e-mail fica lembrado).
  Por baixo, tudo segue rodando: agentes, terminais e o servidor que os outros
  acessam. O que a pessoa faz no app sai assinado com o nome dela. **Sair**, na
  barra lateral, troca de pessoa. Com o Control fora do ar, entra só a última
  pessoa que usou a máquina nas últimas 12 horas (marcada como offline).
- **Adicionar servidor com login:** em Configurações → Servidores → Adicionar
  servidor, basta digitar o endereço (como `orca.devnx.com.br`). Quem já entrou
  no app não digita senha de novo; sem login, o diálogo pede e-mail e senha. O
  aparelho aparece no servidor como "Nome · app". O link de acesso continua
  como segunda opção.
- **Foto da pessoa:** a foto do perfil do Control aparece em "Online agora", em
  quem está olhando cada agente e em quem mandou o último comando. Quem não tem
  foto segue com as iniciais.
- Acesso feito por link (sem login) aparece como **Acesso por link**, e não mais
  como "Runtime 30/10/2026".
- **Endereço deste computador:** o endereço usado em "Compartilhar este
  computador" fica gravado por máquina e já vem preenchido na próxima vez. Dá
  para editar em Configurações → Servidores → Endereço deste computador.

## 1.4.214-pit11 — 30/10/2026

- O cabeçalho de cada projeto na barra lateral mostra o **projeto do DevNX
  Control** a que ele está ligado. Um clique abre esse projeto no Control.
- Projeto sem vínculo ganha o aviso **Vincular**, em amarelo: o trabalho feito
  nele não conta para nenhum projeto na Carga. Para o admin, o clique leva
  direto ao campo do vínculo nas configurações do projeto; para os demais,
  o aviso pede que um administrador faça o vínculo.

## 1.4.214-pit10 — 29/10/2026

- Sincronizado com o Orca de 29/10/2026 (duas semanas de novidades do Orca).
- O Orca agora tem tradução oficial em português do Brasil, e o Orca-Pit
  passa a usar essa tradução. As frases próprias do Orca-Pit (DevNX Control,
  Sobre o Orca-Pit, Ativos/Inativos, Agentes) continuam em português.
- Com "Ocultar branch padrão" ligado, um subgrupo de projetos vazio também
  some da barra lateral, como já acontecia com os projetos vazios.

**Orca da empresa: várias pessoas no mesmo Orca**

- **Login com o DevNX Control:** quem abre o endereço do computador central no
  navegador entra com o e-mail e a senha do Control, sem link de pareamento. O
  acesso nasce no nome da pessoa ("Ana · navegador"). Entra quem divide ao menos
  uma empresa com o central; quem é desligado no Control perde o acesso em até
  10 minutos.
- **Papéis:** admin no Control é admin no Orca. Os demais trabalham nos
  projetos, mas não mexem em configurações, contas, skills nem no servidor.
- **Diário de atividade:** cada mensagem ao agente, linha enviada no terminal
  (o que parece senha vira "[oculto]"), workspace criado, agente iniciado e
  parado (com os tokens) e mudança de configuração fica assinada com a pessoa,
  guardada no central e enviada ao Control a cada 2 minutos, onde aparece na
  tela **Carga**.
- **Barra lateral para trabalho remoto:** cada agente mostra a máquina em que
  roda (com cor própria), quem mandou o último comando ("Fabio · 3m") e quem
  está olhando agora. Novos filtros "Meus agentes", por pessoa e por máquina, e
  a faixa "Online agora" com quem está conectado.
- **Projetos e cartões do Control:** cada projeto do Orca pode ser ligado ao
  projeto do Control (com sugestão pelo repositório git). Os cartões aparecem em
  Tarefas e no Cmd+J, com "Minhas", e um workspace pode nascer de um cartão.
  Cada pessoa vê os cartões com o próprio login.
- **Discos do servidor:** ao escolher uma pasta numa máquina remota, a linha
  "Locais" leva direto à pasta pessoal, à raiz ou a cada disco, com o espaço
  livre.

## 1.4.214-pit9 — 27/10/2026

- O **Claude Chat** passa a usar a conta do DevNX Control, como os terminais já
  usavam. Antes ele procurava o login do sistema (`~/.claude`), que nessas
  máquinas fica vazio, e toda conversa falhava com "O Claude não está
  conectado", mesmo com a licença em dia.

## 1.4.214-pit8 — 19/10/2026

- Agrupar por **Agentes** virou a lista de trabalho: aparecem todos os
  projetos, mesmo sem agente rodando, e embaixo de cada um só os agentes dele,
  um por linha.
- Projeto dentro de grupo (como wbimoveis → wbimoveis-full-painel) não ganha
  mais um cabeçalho próprio: os agentes aparecem direto sob o grupo, e o **+**
  do cabeçalho do grupo cria o workspace no projeto de dentro.
- Vários agentes no mesmo workspace não se resumem mais a um "+1": cada um tem
  a sua linha.

## 1.4.214-pit7 — 17/10/2026

- Relay próprio para o celular: com um token no arquivo
  `~/.config/orca-pit/relay-token` (um por computador), o Orca-Pit usa o relay
  da DevNX no lugar do Orca Relay, sem conta do Orca. Em Configurações → Mobile,
  a opção Orca Relay já aparece liberada e o QR leva o celular ao nosso relay;
  ele funciona de qualquer rede, sem túnel nem porta aberta.
- Sem o arquivo, nada muda.

## 1.4.214-pit6 — 15/10/2026

- Ajuda → **Sobre o Orca-Pit** abre uma tela do app no lugar da janelinha do
  sistema: versão instalada, versão do Orca em que ela se baseia, última
  publicada, situação (atualizado ou quantas versões novas) e o histórico de
  releases, com as etiquetas Instalada, Nova e Retirada.
- Ajuda → Verificar atualizações leva para a mesma tela (na pit5 não fazia nada).
- A janela nativa de Sobre, quando aparece, mostra a versão com o "-pitN".

## 1.4.214-pit5 — 15/10/2026

- Atualização pelo próprio app: em Configurações → Geral → Atualizações aparece
  a versão instalada com o "-pitN", e o botão "Verificar atualizações" mostra o
  que mudou em cada versão nova e instala a mais nova (pede a senha de
  administrador e reinicia o app sozinho).
- Sincronizado com o Orca de 15/10/2026 (quadro do Jira, favoritos do Jira,
  aviso quando o serviço de terminal trava, copiar ao selecionar também no chat).

## 1.4.214-pit4 — 15/10/2026

- No agrupamento **Agentes**, o agente que roda em outra máquina (um servidor
  Orca pareado ou um host SSH) mostra ao lado o nome dela, como "Nitro5". O que
  roda neste computador fica sem selo.

## 1.4.214-pit3 — 15/10/2026

- Novo agrupamento **Agentes** em Opções da lista (ícone de ajustes ao lado de
  "Projetos") → Agrupar por. A lista mostra só o nome do projeto e, embaixo,
  os agentes dele: workspace sem agente, pasta e projeto parado saem da tela.
  Clicar no agente abre o terminal dele, como antes.
- Os atalhos Ctrl+1–9 e Ctrl+Shift+↑/↓ seguem a mesma lista enxuta.
- Para voltar ao normal, escolha "Projeto" no mesmo lugar.

## 1.4.214-pit2 — 14/10/2026

- Projetos se dividem em **Ativos** e **Inativos** na barra lateral. Um
  projeto fica em Ativos por 12 horas depois da última mensagem que você
  enviou a um agente dele; sem mensagem nesse tempo, desce para Inativos.
  A unidade é o grupo de projetos inteiro (ou o projeto avulso).
- As seções só aparecem quando há projetos dos dois lados, e cada uma recolhe
  com um clique no cabeçalho.
- Liga e desliga em Opções da lista (ícone de ajustes ao lado de "Projetos")
  → "Separar ativos e inativos".

## 1.4.214-pit1 — 14/10/2026

Primeira versão publicada.

- Contas do Claude, Codex e Antigravity vêm do DevNX Control, com o mesmo
  pareamento do Cockpit: quem já está conectado no Cockpit não faz login de novo.
- App inteiro em português.
- Com "Ocultar branch padrão" ligado, o grupo de projetos mostra só os
  projetos com workspace aberto.
- O estado do agente (rodando, terminou) aparece na barra lateral também nos
  terminais do DevNX.
- Atualização automática pela Stably desligada: versão nova sai por aqui.
- Sincronizado com o Orca de 14/10/2026 (Jira, busca de tarefas no Cmd+J,
  correções de SSH e do navegador dos agentes).
