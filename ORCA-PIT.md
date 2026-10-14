# Orca-Pit

Fork do [Orca](https://github.com/stablyai/orca) da DevNX. A única diferença é a
conta dos agentes: em vez de cada pessoa fazer login no Claude, no Codex e no
Antigravity, o Orca-Pit entra no **DevNX Control** com e-mail e senha e o painel
escolhe a conta de cada terminal novo — o mesmo que o Cockpit faz.

## Como usar

Configurações → Contas → **DevNX Control**. Informe o endereço do painel
(padrão `https://bcontrol.devnx.com.br`), e-mail e senha. A tabela mostra as
contas do painel com o uso de 5 horas e da semana; **Usar** fixa uma conta.

## Como funciona

| Agente | O que o terminal recebe | Onde fica a sessão |
|---|---|---|
| Claude | `CLAUDE_CODE_OAUTH_TOKEN` com uma capability local e `ANTHROPIC_BASE_URL` apontando para o broker loopback | Só na memória do Orca. O broker troca a capability pelo token da conta a cada chamada, então trocar de conta vale até para terminal aberto |
| Codex | `CODEX_HOME` da conta e `CODEX_REFRESH_TOKEN_URL_OVERRIDE` apontando para o broker | `auth.json` 0600 com um placeholder no lugar do refresh token. O refresh real é feito pelo painel |
| Antigravity | Um shim `agy` no início do `PATH` que troca o `HOME` só do processo do CLI | Arquivo de sessão na pasta da conta |

Tudo mora em `<userData>/devnx-control` (`~/.config/orca/devnx-control` no app
instalado). Os logins pessoais em `~/.claude`, `~/.codex` e `~/.gemini` não são
usados nem alterados. Sem conexão com o painel, o Orca se comporta como o
original.

O código está em `src/main/devnx-control/`. A injeção acontece no fim de
`buildPtyHostEnv` (`src/main/ipc/pty/host-env/assembly.ts`) e no resolvedor do
`CODEX_HOME` (`src/main/startup/codex-launch-preparation.ts`).

## Regras de segurança

- Refresh token nunca sai do painel. Uma resposta que traga um é recusada.
- O broker só aceita conexão de `127.0.0.1`, sem `Origin`, `Referer` ou
  `Sec-Fetch-Site`.
- A porta e as capabilities ficam salvas em `runtime.json` (0600) porque os
  terminais do daemon do Orca sobrevivem ao reinício do app.

## Atualizar a partir do Orca

```bash
git fetch upstream
git merge upstream/main
```

Os pontos de contato com o código do Orca são poucos e marcados com
`Orca-Pit:` nos comentários.

## Publicar uma versão

```bash
# 1. sincronizar com o Orca (ver acima) e commitar
# 2. escrever a entrada "## <versão>-pitN" no ORCA-PIT-CHANGELOG.md e commitar
config/scripts/orca-pit-release.sh
```

O script gera o `.deb`, confere a versão, o tamanho e o módulo do DevNX dentro
do pacote, e sobe tudo para `s3://arquivos.devnx.com.br/orca-pit/v<versão>/`
no Wasabi (profile `wasabi` do aws-cli), como o `release.sh` do Cockpit. A
versão é a do Orca + `-pitN`, com N o próximo número livre no bucket.

Instalar ou atualizar em qualquer máquina:

```bash
curl -fsSL https://arquivos.devnx.com.br/orca-pit/install.sh | sudo bash
```

`--sem-upload` só gera o pacote em `dist/`; `--sem-build` reaproveita a
compilação que já está em `out/`.
