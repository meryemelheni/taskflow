# ⚡ TaskFlow — gestion de tâches collaborative (Kubernetes / K3s)

Application full-stack moderne : tableau **Kanban drag & drop**, sous-tâches, commentaires, priorités, échéances,
assignation, recherche/filtres, **dashboard** de statistiques, **flux d'activité**, mode sombre, authentification JWT.

## Architecture

```
                    Traefik (Ingress K3s)
                           │
                   ┌───────▼────────┐
                   │ frontend (nginx)│  SPA + reverse-proxy /api/*
                   └──┬─────┬─────┬──┘
        /api/auth     │     │     │  /api/analytics
              ┌───────▼┐ ┌──▼─────┴┐ ┌▼────────────────┐
              │  auth  │ │  task   │─▶ analytics-service│  (événements HTTP interne)
              │service │ │ service │ │                  │
              └───┬────┘ └────┬────┘ └────────┬─────────┘
                  │           │               │
            ┌─────▼───────────┼───────────────▼─────┐   ┌──────────┐
            │ PostgreSQL (SQL): auth_db + analytics_db│   │ MongoDB  │ (NoSQL) tâches
            └─────────────────┘                        └──────────┘
```

| Composant | Techno | Données |
|---|---|---|
| frontend | HTML/CSS/JS vanilla + nginx-unprivileged | — |
| auth-service | Node.js / Express | PostgreSQL (`auth_db`) : utilisateurs, bcrypt + JWT |
| task-service | Node.js / Express / Mongoose | **MongoDB** : tâches, sous-tâches, commentaires |
| analytics-service | Node.js / Express | PostgreSQL (`analytics_db`) : événements, stats |

## Lancer en local
```bash
cp .env.example .env && docker compose up --build   # http://localhost:8080
```

## Déploiement K3s (1 master + 2 workers)

**1. Nettoyer les anciennes VMs** (workers puis master) :
```bash
scp scripts/cleanup-node.sh user@VM:~ && ssh user@VM 'sudo ./cleanup-node.sh && sudo reboot'
```
**2. Installer K3s** : `sudo ./scripts/install-master.sh` (sur le master, affiche l'IP et le token), puis sur chaque worker
`sudo ./scripts/install-worker.sh <IP_MASTER> <TOKEN>`. Vérifier : `kubectl get nodes` → 3 nœuds `Ready`.

**3. Publier les images** : pousser ce repo sur GitHub (branche `main`) → l'Action *build-and-push* publie les 4 images
dans GHCR. Dans *Profile → Packages*, passer chaque package en **Public** (ou créer un imagePullSecret).

**4. Déployer** (sur le master) :
```bash
git clone https://github.com/<OWNER>/taskflow.git && cd taskflow
./scripts/deploy.sh <OWNER>
```
Application sur `http://<IP_MASTER>/` (Traefik écoute sur les 3 nœuds).

## Bonnes pratiques Kubernetes appliquées
- **Namespace dédié**, `ResourceQuota`, Pod Security labels (baseline enforce / restricted warn)
- **Secrets** générés au déploiement (aucun secret dans Git), injectés via `secretKeyRef`
- **StatefulSet + PVC** (`local-path`) pour PostgreSQL et MongoDB, auth MongoDB activée
- **Deployments** : 2 replicas, `RollingUpdate` (maxUnavailable 0), `topologySpreadConstraints` multi-nœuds
- **Probes** `startup` / `liveness` / `readiness` (readiness vérifie la connexion BD), `preStop` + graceful shutdown (SIGTERM)
- **Resources** requests/limits partout ; **HPA** (CPU 70 %) ; **PodDisruptionBudget**
- **Sécurité des pods** : non-root, `readOnlyRootFilesystem`, `drop ALL` capabilities, `seccomp RuntimeDefault`, pas de token SA monté
- **NetworkPolicies** zero-trust : deny-all puis flux autorisés (ingress→front→backends, task→analytics, services→BD)
- Images **multi-stage** légères (alpine), tags immuables par SHA via CI, `kustomize` pour l'assemblage
- Endpoint `/internal/events` protégé par clé interne et non exposé par nginx

## Fonctionnalités
Inscription/connexion · Kanban 4 colonnes · drag & drop · priorités · échéances & retard · labels · sous-tâches avec progression ·
commentaires · assignation · recherche & filtres · dashboard (KPI, répartition, courbe 7 jours, top contributeurs) · journal d'activité · thème clair/sombre.
