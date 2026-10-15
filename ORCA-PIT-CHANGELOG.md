# Orca-Pit — mudanças

Cada versão é a do Orca em que o fork está + `-pitN`. Instalar a última:

```bash
curl -fsSL https://arquivos.devnx.com.br/orca-pit/install.sh | sudo bash
```

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
