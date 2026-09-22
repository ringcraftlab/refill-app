#!/usr/bin/env bash
# Compares the working tree against an earlier commit, on screen.
#
#   npm run baseline            # against HEAD
#   npm run baseline -- HEAD~3
#
# CLAUDE.md says a change that "should not change anything visible" has to be
# proved, not assumed. Proving it was six commands -- worktree, symlink,
# build, two servers, two shoots, two comparisons -- so it got skipped. This
# is that sequence, once.
#
# Leaves two things behind: pixdiff's per-scene percentages (which pictures
# moved) and uidiff's numbers (which elements moved, in pixels). The pictures
# say something changed; the numbers say what.
set -euo pipefail

REF="${1:-HEAD}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OLD_TREE=/tmp/baseline-old
cd "$ROOT"

SHA="$(git rev-parse --short "$REF")"
echo "== 比較相手 $SHA  $(git log -1 --format=%s "$REF")"

# A worktree shares the object store, so this costs no clone. node_modules is
# symlinked rather than installed: the deps are the same and installing them
# again is most of the wall time.
git worktree remove "$OLD_TREE" --force 2>/dev/null || true
git worktree add --detach "$OLD_TREE" "$SHA" >/dev/null
ln -sfn "$ROOT/node_modules" "$OLD_TREE/node_modules"

cleanup() {
  kill %1 %2 2>/dev/null || true
  git worktree remove "$OLD_TREE" --force 2>/dev/null || true
}
trap cleanup EXIT

echo "== 2つビルド"
(cd "$OLD_TREE" && npx vite build >/dev/null)
npx vite build >/dev/null

(cd "$OLD_TREE" && npx vite preview --port 4174 --strictPort >/dev/null 2>&1) &
(npx vite preview --port 4173 --strictPort >/dev/null 2>&1) &
for port in 4174 4173; do
  until curl -sf -o /dev/null "http://localhost:$port/"; do sleep 0.3; done
done

echo "== 12場面を2回撮る"
rm -rf shots/baseline-old shots/baseline-new
BASE_URL=http://localhost:4174 node scripts/shoot.mjs shots/baseline-old >/dev/null
node scripts/shoot.mjs shots/baseline-new >/dev/null

echo
echo "== どの絵が動いたか（pixdiff）"
python3 scripts/pixdiff.py shots/baseline-old shots/baseline-new
echo
echo "== どの要素が動いたか（uidiff）"
node scripts/uidiff.mjs http://localhost:4174 http://localhost:4173
