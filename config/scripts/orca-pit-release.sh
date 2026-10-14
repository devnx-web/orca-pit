#!/usr/bin/env bash
# =============================================================
# config/scripts/orca-pit-release.sh — publica uma versão do Orca-Pit
# =============================================================
# Mesma rotina do release.sh do Cockpit:
#   1. descobre a versão: a do Orca (package.json) + "-pitN", com N o
#      próximo número livre no bucket
#   2. gera o .deb (build:release + electron-builder)
#   3. monta install.sh e SHA256SUMS
#   4. sobe para s3://arquivos.devnx.com.br/orca-pit/v<versão>/ e atualiza
#      o orca-pit/install.sh da raiz, que sempre instala a última
#
# Uso:
#   config/scripts/orca-pit-release.sh               # build → upload
#   config/scripts/orca-pit-release.sh --sem-upload  # só gera em dist/
#   config/scripts/orca-pit-release.sh --sem-build   # reaproveita o build em out/
#
# Pré-requisitos: aws-cli v2 com o profile "wasabi", Node 24 via nvm e a
# entrada "## <versão>" no ORCA-PIT-CHANGELOG.md.
# =============================================================

set -euo pipefail

SKIP_BUILD=""
SKIP_UPLOAD=""
for arg in "$@"; do
  case "$arg" in
    --sem-build) SKIP_BUILD=1 ;;
    --sem-upload) SKIP_UPLOAD=1 ;;
    *) echo "argumento desconhecido: $arg"; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Why "arquivos.devnx.com.br" sem "c": é o bucket que o CDN público serve.
BUCKET="arquivos.devnx.com.br"
PREFIX="orca-pit"
AWS_OPTS=(--profile wasabi --region us-central-1 --endpoint-url https://s3.us-central-1.wasabisys.com)
# Why o teto: o pacote tem ~185 MB; bem acima disso é pasta solta na raiz
# do repositório entrando no app.asar (já aconteceu com um backup de dist/).
MAX_DEB_BYTES=$((300 * 1024 * 1024))

ORCA_VERSION="$(node -p "require('./package.json').version")"

# ---------- 1. versão ----------
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERRO: há alterações não commitadas. A versão publicada precisa ser um commit."
  exit 1
fi

N=1
if [[ -z "$SKIP_UPLOAD" ]]; then
  while aws "${AWS_OPTS[@]}" s3 ls "s3://${BUCKET}/${PREFIX}/v${ORCA_VERSION}-pit${N}/" >/dev/null 2>&1; do
    N=$((N + 1))
  done
fi
RELEASE="${ORCA_VERSION}-pit${N}"

if ! grep -q "^## ${RELEASE}\b" ORCA-PIT-CHANGELOG.md; then
  echo "ERRO: falta a entrada \"## ${RELEASE}\" no ORCA-PIT-CHANGELOG.md."
  exit 1
fi

echo ""
echo "  ────────────────────────────────────────────"
echo "  Orca-Pit release"
echo "  ────────────────────────────────────────────"
echo "  versão do Orca:  $ORCA_VERSION"
echo "  versão nova:     $RELEASE"
echo "  commit:          $(git rev-parse --short HEAD)"
echo "  destino:         s3://${BUCKET}/${PREFIX}/v${RELEASE}/"
echo "  ────────────────────────────────────────────"
echo ""

# ---------- 2. build ----------
if [[ -z "$SKIP_BUILD" ]]; then
  echo "▸ instalando dependências do app mobile (o build embute a versão web dele)…"
  (cd mobile && corepack pnpm install --frozen-lockfile)
  echo "▸ compilando…"
  corepack pnpm run build:release
  corepack pnpm run ensure:electron-runtime
else
  echo "▸ compilação pulada (--sem-build)"
fi

rm -rf dist
echo "▸ gerando o .deb…"
# Why buildNumber: vira o "-pitN" da versão do .deb sem mudar a versão que o app mostra.
corepack pnpm exec electron-builder --config config/electron-builder.config.cjs \
  --linux deb --publish never -c.buildNumber="pit${N}"

BUILT="dist/orca-ide_${ORCA_VERSION}_amd64.deb"
DEB_NAME="orca-pit_${RELEASE}_amd64.deb"
mv "$BUILT" "dist/${DEB_NAME}"

DEB_VERSION="$(dpkg-deb -f "dist/${DEB_NAME}" Version)"
if [[ "$DEB_VERSION" != "$RELEASE" ]]; then
  echo "ERRO: o .deb saiu com a versão $DEB_VERSION, esperava $RELEASE."
  exit 1
fi
DEB_BYTES="$(stat -c %s "dist/${DEB_NAME}")"
if (( DEB_BYTES > MAX_DEB_BYTES )); then
  echo "ERRO: o .deb tem $((DEB_BYTES / 1024 / 1024)) MB. Confira se há pasta solta na raiz do repositório."
  exit 1
fi
if ! grep -q -a "devnx-control" dist/linux-unpacked/resources/app.asar; then
  echo "ERRO: o pacote não contém o módulo devnx-control."
  exit 1
fi

# ---------- 3. install.sh + checksums ----------
sed "s/__RELEASE__/${RELEASE}/" config/scripts/orca-pit-install.sh > dist/install.sh
cp ORCA-PIT-CHANGELOG.md dist/CHANGELOG.md
(cd dist && sha256sum "$DEB_NAME" install.sh > SHA256SUMS)
echo "  ✓ dist/${DEB_NAME} ($((DEB_BYTES / 1024 / 1024)) MB), install.sh, SHA256SUMS"

if [[ -n "$SKIP_UPLOAD" ]]; then
  echo ""
  echo "▸ upload pulado (--sem-upload). Para instalar daqui:"
  echo "    sudo apt install $ROOT/dist/${DEB_NAME}"
  exit 0
fi

# ---------- 4. upload ----------
DEST="s3://${BUCKET}/${PREFIX}/v${RELEASE}/"
echo ""
echo "▸ subindo para $DEST"

# Sem --acl: o bucket usa Bucket Policy, e passar ACL dá AccessDenied no Wasabi.
upload() {
  echo "  · $(basename "$1") → $2"
  aws "${AWS_OPTS[@]}" s3 cp "$1" "$2" --no-progress --content-type "$3"
}

upload "dist/${DEB_NAME}" "$DEST" "application/vnd.debian.binary-package"
upload dist/CHANGELOG.md "$DEST" "text/markdown; charset=utf-8"
upload dist/SHA256SUMS "$DEST" "text/plain; charset=utf-8"
# O ponto de entrada só fica disponível depois dos arquivos que ele precisa.
upload dist/install.sh "$DEST" "text/x-shellscript"
upload dist/install.sh "s3://${BUCKET}/${PREFIX}/install.sh" "text/x-shellscript"

git tag "orca-pit-v${RELEASE}"

echo ""
echo "  ✓ Orca-Pit v${RELEASE} publicado (tag local orca-pit-v${RELEASE})"
echo ""
echo "  Instalar a última versão:"
echo "    curl -fsSL https://${BUCKET}/${PREFIX}/install.sh | sudo bash"
echo ""
echo "  Instalar exatamente esta:"
echo "    curl -fsSL https://${BUCKET}/${PREFIX}/v${RELEASE}/install.sh | sudo bash"
echo ""
