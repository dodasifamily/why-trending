#!/usr/bin/env bash
# 시험용 APK 를 'test-latest' 릴리스에 올려요. (폰에서 로그인 없이 내려받는 링크예요)
#   https://github.com/<저장소>/releases/download/test-latest/whyttuji-test.apk
# GitHub Actions 안에서만 써요 (GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_RUN_NUMBER 가 필요해요).
#
# 방식
#  - 이미 공개된 릴리스가 있으면 지우지 않고 그대로 두고, 파일(APK)과 설명만 바꿔요.
#    새 것이 올라가기 전에는 아무것도 지우지 않아서, 중간에 실패해도 링크가 사라지지 않아요.
#    (예전에는 지우고 다시 만들다가 '만들기'가 403 으로 거절돼 링크가 사라진 적이 두 번 있었어요)
#  - 릴리스가 없으면(처음이거나 누가 지웠으면) 새로 만들어요. 태그는 '이번 빌드의 커밋'이 아니라 main 의 끝에 달아요.
#    빌드가 도는 동안 main 이 앞으로 나아가면, 옛 커밋에 태그를 다는 요청을 GitHub 이 거절하는 것으로 보여요.
#    (어느 커밋에서 만든 앱인지는 릴리스 설명에 빌드 번호와 커밋으로 적어요)
#  - 실패하면 잠시 쉬었다가 최대 4번까지 다시 해요. 끝나면 공개 릴리스인지, 파일 크기가 맞는지 확인해요.
set -euo pipefail

TAG="test-latest"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY 가 없어요}"
TARGET="${GITHUB_REF_NAME:-main}"
TITLE="왜뜨지 시험용 앱 (최신)"
APK="$(ls app/android/app/build/outputs/apk/debug/*.apk | head -n 1)"
cp "$APK" whyttuji-test.apk
LOCAL_SIZE="$(wc -c < whyttuji-test.apk | tr -d ' ')"
NOTES="폰에 바로 설치해 써볼 수 있는 시험용 앱이에요. 광고는 구글 테스트 광고만 나와요. 정식 출시용이 아니에요. (빌드 ${GITHUB_RUN_NUMBER:-?}, 커밋 ${GITHUB_SHA:0:7})"
PAUSE="${RELEASE_RETRY_PAUSE:-8}"

# 이 태그의 릴리스들을 "id<TAB>초안<TAB>시험판" 줄로 보여줘요
list_releases() {
  gh api "repos/${REPO}/releases?per_page=100" | python3 -c '
import sys, json
for r in json.load(sys.stdin):
    if r.get("tag_name") == sys.argv[1]:
        print("%s\t%s\t%s" % (r["id"], str(bool(r.get("draft"))).lower(), str(bool(r.get("prerelease"))).lower()))
' "$TAG"
}

# 안 보이는 초안 찌꺼기만 지워요 (공개된 릴리스는 건드리지 않아요)
clean_drafts() {
  local line id draft
  while IFS=$'\t' read -r id draft _; do
    [ "$draft" = "true" ] || continue
    echo "초안 릴리스 ${id} 지움"
    gh api -X DELETE "repos/${REPO}/releases/${id}" >/dev/null || true
  done < <(list_releases || true)
}

# 실패하면 쉬었다가 최대 4번까지 다시 해요
attempt() {
  local n=1
  until "$@"; do
    if [ "$n" -ge 4 ]; then
      echo "4번 시도했지만 실패했어요: $1 $2 $3" >&2
      return 1
    fi
    echo "실패 (${n}번째). $((n * PAUSE))초 뒤 다시 해요."
    sleep $((n * PAUSE))
    n=$((n + 1))
    clean_drafts
  done
}

echo "== 올리기 전 상태 (id / 초안 / 시험판) =="
CURRENT="$(list_releases || true)"
echo "${CURRENT:-(이 태그의 릴리스가 없어요)}"
PUBLISHED_ID="$(awk -F'\t' '$2=="false"{print $1; exit}' <<<"$CURRENT")"
clean_drafts

if [ -n "$PUBLISHED_ID" ]; then
  echo "== 공개된 릴리스 ${PUBLISHED_ID} 는 그대로 두고 파일과 설명만 바꿔요 =="
  attempt gh release upload "$TAG" whyttuji-test.apk --clobber
  attempt gh release edit "$TAG" --title "$TITLE" --notes "$NOTES" --prerelease
else
  echo "== 새 릴리스 만들기 (태그는 ${TARGET} 의 끝에 달아요) =="
  attempt gh release create "$TAG" whyttuji-test.apk --title "$TITLE" --notes "$NOTES" --prerelease --target "$TARGET"
fi

echo "== 올린 뒤 확인 =="
gh api "repos/${REPO}/releases/tags/${TAG}" | python3 -c '
import sys, json
r = json.load(sys.stdin)
local = int(sys.argv[1])
print(r.get("html_url"), "| draft=%s prerelease=%s" % (str(r.get("draft")).lower(), str(r.get("prerelease")).lower()))
for a in r.get("assets", []):
    print("  %s %d바이트 (%s, 올라온 시각 %s)" % (a["name"], a["size"], a.get("state"), a.get("updated_at")))
if r.get("draft"):
    sys.exit("릴리스가 초안으로 남았어요. 공개되지 않았어요.")
apk = [a for a in r.get("assets", []) if a["name"] == "whyttuji-test.apk"]
if not apk or apk[0]["size"] <= 0:
    sys.exit("whyttuji-test.apk 가 릴리스에 올라가지 않았어요.")
if apk[0]["size"] != local:
    sys.exit("올라간 파일 크기(%d)가 만든 파일 크기(%d)와 달라요." % (apk[0]["size"], local))
' "$LOCAL_SIZE"
echo "::notice title=시험용 앱 링크::https://github.com/${REPO}/releases/download/${TAG}/whyttuji-test.apk (${LOCAL_SIZE} 바이트, 빌드 ${GITHUB_RUN_NUMBER:-?})"
