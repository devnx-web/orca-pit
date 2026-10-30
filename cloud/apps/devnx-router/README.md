# Roteador `orca.devnx.com.br/<máquina>`

Cloudflare Worker do Orca-Pit. Lê o primeiro trecho do caminho (`/nitro5/…`), pergunta ao DevNX Control qual é o túnel escondido daquela máquina (`orca-<slug>-<hex>.devnx.com.br`), tira o prefixo e repassa HTTP e WebSocket. O WebSocket passa direto: o Worker não toca nas mensagens, e o Orca as cifra de ponta a ponta. Contrato: `contrato-maquinas.md` (v1.2+).

- `/` → `302 /ftgknote/` até 30/11/2026; depois, a página "Escolha a máquina" (`/?maquina=nitro5` → `/nitro5/`).
- `/nitro5` sem barra → `301 /nitro5/`, para os endereços relativos do cliente web manterem o prefixo. Um WebSocket em `/nitro5` vai direto para `/` da máquina.
- Caminhos do Orca sem prefixo (`/web-index.html`, `/assets/…`, `/orca-pit/login` e o WebSocket em `/`) vão para o ftgkNote: são os aparelhos pareados com `wss://orca.devnx.com.br` antes do roteador.
- A cada requisição à máquina o Worker manda `X-Orca-Origin-Secret` (o `origin_secret` que o Control devolve) e `X-Orca-Client-IP` (o IP de quem acessa). Ele apaga os dois se vierem do cliente.
- A resposta do Control fica 60 s no cache (15 s quando a máquina não existe). Erros do Control não entram no cache.
- Até 30/11/2026, `ftgknote` e `nitro5` sem túnel gerenciado caem nos túneis feitos à mão (`orca.devnx.com.br`, `nitro5.devnx.com.br`).

## Deploy

Precisa só do login do Cloudflare no navegador (OAuth), sem token criado à mão.

```bash
cd ~/orca-pit/cloud/apps/devnx-router
npx wrangler@4 login                          # abre o navegador; um clique
npx wrangler@4 secret put ORCA_ROUTER_KEY      # o mesmo valor de ORCA_ROUTER_KEY no .env do Control
npx wrangler@4 deploy
```

Conferir logo depois:

```bash
curl -sI https://orca.devnx.com.br/ | grep -i location          # /ftgknote/
curl -s -o /dev/null -w '%{http_code}\n' https://orca.devnx.com.br/ftgknote/web-index.html   # 200
```

Se algo der errado, `npx wrangler@4 delete --name orca-devnx-router` tira a rota e `orca.devnx.com.br` volta a ir direto ao túnel do ftgkNote.

## Testes

```bash
cd ~/orca-pit
node_modules/.bin/vitest run --config cloud/apps/devnx-router/vitest.config.mts
node_modules/.bin/tsc -p cloud/apps/devnx-router/tsconfig.json
```

O teste de ponta a ponta com o servidor real do Orca atrás de um proxy com prefixo está em `src/main/devnx-control/orca-pit-router-prefix.test.ts`.

## Custo

Pela [tabela de preços do Workers](https://developers.cloudflare.com/workers/platform/pricing/), cada conexão WebSocket conta como **uma** requisição (o `Upgrade`), e "WebSocket messages routed through a Worker do not count as requests". O tempo de parede não é cobrado, só a CPU, e o repasse não gasta CPU depois do aperto de mão. O plano gratuito dá 100.000 requisições por dia. Uma pessoa abrindo o cliente web gasta algumas dezenas (página, assets na primeira vez, login, um WebSocket por reconexão), bem abaixo disso para uma equipe pequena.
