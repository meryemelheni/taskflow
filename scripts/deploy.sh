#!/usr/bin/env bash
# Usage (sur le master) : ./scripts/deploy.sh <GITHUB_OWNER> [TAG]
set -euo pipefail
OWNER="${1:?Usage: $0 <github_owner> [tag]}"; TAG="${2:-latest}"
cd "$(dirname "$0")/../k8s"
kubectl apply -f 00-namespace.yaml
# Secrets générés aléatoirement (jamais commités dans Git) ; conservés si déjà présents
if ! kubectl -n taskflow get secret taskflow-secrets >/dev/null 2>&1; then
  kubectl -n taskflow create secret generic taskflow-secrets \
    --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 16)" \
    --from-literal=MONGO_PASSWORD="$(openssl rand -hex 16)" \
    --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
    --from-literal=INTERNAL_KEY="$(openssl rand -hex 24)"
fi
TMP=$(mktemp -d); cp -r . "$TMP"; sed -i "s#OWNER#${OWNER,,}#g; s#newTag: latest#newTag: ${TAG}#g" "$TMP/kustomization.yaml"
kubectl apply -k "$TMP"; rm -rf "$TMP"
for d in auth-service task-service analytics-service frontend; do kubectl -n taskflow rollout status deploy/$d --timeout=240s; done
kubectl -n taskflow get pods,svc,ingress,hpa
echo "✅ Application disponible sur http://$(hostname -I | awk '{print $1}')/"
