# Orca-Pit — mudanças

Cada versão é a do Orca em que o fork está + `-pitN`. Instalar a última:

```bash
curl -fsSL https://arquivos.devnx.com.br/orca-pit/install.sh | sudo bash
```

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
