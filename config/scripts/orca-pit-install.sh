#!/usr/bin/env bash
# Instalador do Orca-Pit. O orca-pit-release.sh troca __RELEASE__ pela versão
# ao publicar; não rode este arquivo direto do repositório.
set -euo pipefail

RELEASE="__RELEASE__"
BASE_URL="https://arquivos.devnx.com.br/orca-pit/v${RELEASE}"
DEB_FILE="orca-pit_${RELEASE}_amd64.deb"

echo ""
echo "  Ailiv — instalador do Orca-Pit v${RELEASE}"
echo ""

ARCH="$(uname -m)"
if [ "$ARCH" != "x86_64" ]; then
  echo "  ERRO: apenas x86_64 suportado (detectado: $ARCH)"
  exit 1
fi

if [ "$(id -u)" != "0" ]; then
  echo "  ERRO: execute este instalador com sudo bash."
  exit 1
fi
for tool in curl dpkg dpkg-query apt-get sha256sum mktemp; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "  ERRO: comando obrigatório não encontrado: $tool (use Debian/Ubuntu)."
    exit 1
  fi
done

INSTALL_DIR="$(mktemp -d -t orca-pit-install.XXXXXXXX)"
trap 'rm -f -- "$INSTALL_DIR/$DEB_FILE" "$INSTALL_DIR/SHA256SUMS"; rmdir -- "$INSTALL_DIR"' EXIT

echo "  Baixando ${DEB_FILE}..."
curl -fsSL --retry 3 --connect-timeout 20 --progress-bar "${BASE_URL}/${DEB_FILE}" -o "$INSTALL_DIR/$DEB_FILE"
curl -fsSL --retry 3 --connect-timeout 20 "${BASE_URL}/SHA256SUMS" -o "$INSTALL_DIR/SHA256SUMS"

echo "  Conferindo integridade do download..."
(cd "$INSTALL_DIR" && sha256sum --check --ignore-missing SHA256SUMS)

echo "  Instalando..."
if ! dpkg -i "$INSTALL_DIR/$DEB_FILE"; then
  echo "  Tentando resolver dependências..."
  apt-get install -f -y
fi
# Why o nome orca-ide: é o pacote do Orca, e o Orca-Pit o substitui no lugar.
if [ "$(dpkg-query -W -f='${Status} ${Version}' orca-ide)" != "install ok installed ${RELEASE}" ]; then
  echo "  ERRO: a instalação da versão ${RELEASE} não foi concluída."
  exit 1
fi

echo ""
echo "  Orca-Pit v${RELEASE} instalado."
echo "  Abra pelo menu (Orca) ou execute: orca-ide"
echo "  Se o aplicativo já estiver aberto, reabra quando suas tarefas puderem ser encerradas."
echo ""
