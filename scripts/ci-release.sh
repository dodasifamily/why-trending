#!/usr/bin/env bash
# 시험용 APK 를 'test-latest' 릴리스에 올려요. (폰에서 로그인 없이 내려받는 링크예요)
#   https://github.com/<저장소>/releases/download/test-latest/whyttuji-test.apk
# GitHub Actions 안에서만 써요 (GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_RUN_NUMBER 가 필요해요).
#
# 예전에는 'gh release delete' 뒤에 'gh release create' 를 바로 이어 불렀는데, 가끔 만드는 쪽이 실패해서
# 링크가 사라졌어요. 그래서 (1) 같은 이름의 예전 릴리스를 초안까지 찾아 모두 지우고 (2) 새로 만든 뒤
# (3) 정말 초안이 아닌 공개 릴리스로 올라갔는지 확인하고, 각 단계의 결과를 로그에 남겨요.
set -euo pipefail

TAG="test-latest"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY 가 없어요}"
APK="$(ls app/android/app/build/outputs/apk/debug/*.apk | head -n 1)"
cp "$APK" whyttuji-test.apk
NOTES="폰에 바로 설치해 써볼 수 있는 시험용 앱이에요. 광고는 구글 테스트 광고만 나와요. 정식 출시용이 아니에요. (빌드 ${GITHUB_RUN_NUMBER:-?}, 커밋 ${GITHUB_SHA:0:7})"

echo "== 올리기 전 릴리스 (id / 태그 / 초안 / 시험판) =="
gh api "repos/${REPO}/releases?per_page=100" --jq '.[] | [.id, .tag_name, (.draft|tostring), (.prerelease|tostring)] | @tsv' || echo "(목록을 읽지 못했어요)"

echo "== 같은 이름의 예전 릴리스 지우기 (초안 포함) =="
OLD_IDS="$(gh api "repos/${REPO}/releases?per_page=100" --jq ".[] | select(.tag_name==\"${TAG}\") | .id" || true)"
for id in $OLD_IDS; do
  echo "릴리스 ${id} 지움"
  gh api -X DELETE "repos/${REPO}/releases/${id}"
done
if gh api -X DELETE "repos/${REPO}/git/refs/tags/${TAG}" >/dev/null 2>&1; then
  echo "태그 ${TAG} 지움"
else
  echo "지울 태그는 없었어요"
fi

echo "== 새 릴리스 만들기 =="
gh release create "$TAG" whyttuji-test.apk \
  --title "왜뜨지 시험용 앱 (최신)" \
  --notes "$NOTES" \
  --prerelease --target "$GITHUB_SHA"

echo "== 올린 뒤 확인 =="
gh release view "$TAG" --json url,isDraft,isPrerelease,assets --jq '[.url, ("draft=" + (.isDraft|tostring)), ("prerelease=" + (.isPrerelease|tostring)), (.assets[] | .name + " " + (.size|tostring) + "B")] | .[]'
DRAFT="$(gh release view "$TAG" --json isDraft --jq '.isDraft')"
if [ "$DRAFT" != "false" ]; then
  echo "릴리스가 초안으로 남았어요. 공개되지 않았어요." >&2
  exit 1
fi
SIZE="$(gh release view "$TAG" --json assets --jq '[.assets[] | select(.name=="whyttuji-test.apk")] | .[0].size // 0')"
if [ "${SIZE}" -le 0 ]; then
  echo "whyttuji-test.apk 가 릴리스에 올라가지 않았어요." >&2
  exit 1
fi
echo "::notice title=시험용 앱 링크::https://github.com/${REPO}/releases/download/${TAG}/whyttuji-test.apk (${SIZE} 바이트, 빌드 ${GITHUB_RUN_NUMBER:-?})"
