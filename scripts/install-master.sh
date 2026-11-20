#!/usr/bin/env bash
# Sur la VM master (après nettoyage). Traefik + local-path + metrics-server sont inclus dans K3s.
set -euo pipefail
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --write-kubeconfig-mode 644" sh -
kubectl wait --for=condition=Ready node --all --timeout=120s
echo; echo "IP master : $(hostname -I | awk '{print $1}')"
echo "TOKEN       : $(cat /var/lib/rancher/k3s/server/node-token)"
echo "Ensuite sur chaque worker : sudo ./install-worker.sh <IP_MASTER> <TOKEN>"
