#!/usr/bin/env bash
# Nettoyage COMPLET d'une VM (master ou worker) : K3s, Docker/containerd, CNI, iptables, données.
# Usage : sudo ./cleanup-node.sh      (à lancer sur CHAQUE VM, workers d'abord puis master)
set -uo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Lancez en root (sudo)"; exit 1; }
echo "==> Désinstallation K3s"
[ -x /usr/local/bin/k3s-agent-uninstall.sh ] && /usr/local/bin/k3s-agent-uninstall.sh
[ -x /usr/local/bin/k3s-uninstall.sh ] && /usr/local/bin/k3s-uninstall.sh
[ -x /usr/local/bin/k3s-killall.sh ] && /usr/local/bin/k3s-killall.sh
echo "==> Services/conteneurs résiduels"
systemctl stop k3s k3s-agent kubelet docker containerd 2>/dev/null
if command -v docker >/dev/null; then
  docker ps -aq | xargs -r docker rm -f
  docker system prune -af --volumes
fi
echo "==> Suppression des données et configs"
umount $(mount | awk '/\/var\/lib\/(kubelet|rancher)/{print $3}') 2>/dev/null
rm -rf /etc/rancher /var/lib/rancher /var/lib/kubelet /etc/cni /opt/cni /var/lib/cni \
       /run/k3s /run/flannel /var/log/pods /var/log/containers ~/.kube /usr/local/bin/{k3s,kubectl,crictl,ctr}
echo "==> Interfaces réseau et iptables"
for i in cni0 flannel.1 flannel-v6.1 kube-ipvs0; do ip link delete "$i" 2>/dev/null; done
iptables-save 2>/dev/null | grep -v -E 'KUBE-|CNI-|flannel' | iptables-restore 2>/dev/null
ip6tables-save 2>/dev/null | grep -v -E 'KUBE-|CNI-|flannel' | ip6tables-restore 2>/dev/null
echo "==> Paquets inutiles"
apt-get autoremove -y >/dev/null 2>&1; apt-get clean
echo "✅ Nœud nettoyé. Redémarrage conseillé : sudo reboot"
