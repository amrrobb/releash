# Sourced by the deploy scripts. Run them from anywhere; paths resolve from the repo root.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VPS="${VPS:-root@77.237.243.126}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE=/opt/releash
ssh_vps() { ssh -i "$SSH_KEY" -o ConnectTimeout=15 "$VPS" "$@"; }
rsync_vps() { rsync -az -e "ssh -i $SSH_KEY" "$@"; }
