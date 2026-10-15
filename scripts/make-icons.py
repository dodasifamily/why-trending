#!/usr/bin/env python3
"""앱 아이콘과 시작 화면 이미지를 만들어요 (Pillow 필요).

  python3 scripts/make-icons.py

만든 파일
  app/assets/icon-only.png        1024x1024  전체 아이콘
  app/assets/icon-foreground.png  1024x1024  적응형 아이콘 앞면 (배경 투명)
  app/assets/icon-background.png  1024x1024  적응형 아이콘 배경 (단색)
  app/assets/splash.png           2732x2732  시작 화면
  app/assets/splash-dark.png      2732x2732  시작 화면 (어두운 모드용, 같은 그림)
  site/icon.png                   512x512    웹 아이콘
디자인: 화면 속 '형광펜 강조'를 그대로 가져왔어요. 라임색 사각형 위에 굵은 물음표.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
COBALT = (0x33, 0x47, 0xFF, 255)
LIME = (0xD9, 0xFF, 0x47, 255)
INK = (0x14, 0x16, 0x1C, 255)
GROUND = (0xF2, 0xF4, 0xF8, 255)

FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def load_font(px):
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, px)
    raise SystemExit("굵은 글꼴을 찾지 못했어요")


def mark(canvas_px, box_ratio):
    """투명한 정사각 캔버스 가운데에 '라임 사각형 + 물음표'를 그려서 돌려줘요."""
    img = Image.new("RGBA", (canvas_px, canvas_px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    box = int(canvas_px * box_ratio)
    left = (canvas_px - box) // 2
    top = (canvas_px - box) // 2
    d.rounded_rectangle([left, top, left + box, top + box], radius=int(box * 0.24), fill=LIME)

    font = load_font(int(box * 0.86))
    l, t, r, b = font.getbbox("?")
    gw, gh = r - l, b - t
    x = left + (box - gw) // 2 - l
    y = top + (box - gh) // 2 - t
    d.text((x, y), "?", font=font, fill=INK)
    return img


def save(img, rel):
    out = ROOT / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PNG", optimize=True)
    print("만들었어요:", rel, img.size)


def main():
    # 전체 아이콘: 파랑 바탕 + 마크
    base = Image.new("RGBA", (1024, 1024), COBALT)
    base.alpha_composite(mark(1024, 0.60))
    save(base, "app/assets/icon-only.png")

    # 적응형 아이콘: 앞면은 안전 영역(가운데 66%) 안에 들어오게 더 작게
    save(mark(1024, 0.46), "app/assets/icon-foreground.png")
    save(Image.new("RGBA", (1024, 1024), COBALT), "app/assets/icon-background.png")

    # 시작 화면: 밝은 바탕 가운데에 마크
    splash = Image.new("RGBA", (2732, 2732), GROUND)
    m = mark(2732, 0.26)
    splash.alpha_composite(m)
    save(splash, "app/assets/splash.png")
    save(splash, "app/assets/splash-dark.png")

    # 웹 아이콘
    save(base.resize((512, 512), Image.LANCZOS), "site/icon.png")


if __name__ == "__main__":
    main()
