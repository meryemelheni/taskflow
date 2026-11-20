#!/usr/bin/env bash
# Usage : sudo ./install-worker.sh <IP_MASTER> <TOKEN>
set -euo pipefail
[ $# -eq 2 ] || { echo "Usage: $0 <IP_MASTER> <TOKEN>"; exit 1; }
curl -sfL https://get.k3s.io | K3S_URL="https://$1:6443" K3S_TOKEN="$2" sh -
