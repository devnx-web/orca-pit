# Orca-Pit — mudanças

Cada versão é a do Orca em que o fork está + `-pitN`. Instalar a última:

```bash
curl -fsSL https://arquivos.devnx.com.br/orca-pit/install.sh | sudo bash
```

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
