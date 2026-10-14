# -*- coding: utf-8 -*-
"""
design/build-assets.py — 把 design/sample/ 的原始素材整理成網站可用的圖庫。

  python design/build-assets.py            # 套用 Velora 統一影調
  python design/build-assets.py --raw      # 保留原始色彩，不套影調

素材有兩個來源：
  A. Brochure/(2026) VUCA_Product Brochure_EN.pdf   → 已由 pdfextract 落到 sample/extracted/
  B. Jewelry accessories/絲巾與飾品.xlsx            → 已由 xlsx_extract 落到 sample/xlsx_media/
     （檔名 cell_<欄><列>_imageN 保留了「這張圖屬於第幾列商品」的對應）

本腳本做三件事：
  1. 合成去背：PDF 內商品照是「黑底 JPEG + 灰階遮罩」，合成回 RGBA PNG。
  2. 統一影調：香調意象圖原色跳（藍天、藍海、桃紅），直接放進暖米白版面會刺眼。
     降飽和至 45% 並壓暖調，落進色票但保有辨識度。人像與商品照不套。
  3. 壓縮輸出：長邊上限 1600，另產 240px 方形縮圖供後台清單使用。

原始檔一律保留在 design/sample/，本腳本永不覆寫來源。
"""
import os
import re
import sys

from PIL import Image, ImageEnhance

# Windows 主控台預設 cp1252，中文訊息會炸；強制 UTF-8 輸出
try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE = os.path.join(ROOT, 'design', 'sample')
EXTRACT = os.path.join(SAMPLE, 'extracted')
XLSX_MEDIA = os.path.join(SAMPLE, 'xlsx_media')
OUT = os.path.join(ROOT, 'velora-frontend', 'public', 'media')

RAW = '--raw' in sys.argv
PUBLIC = '--public' in sys.argv
MAX_EDGE = 1600
THUMB = 240

# ── 公開版影像白名單 ────────────────────────────────────────
# 網站實際用到的固定素材只有這幾張（2026-10-15 盤點）：主視覺輪播與理念區的
# 照片、三個品類封面。商品圖在 D1，不從這裡出。供應商影像放上公開站台
# 等同開放下載，所以白名單只留版面真的引用的檔案 —— 加新圖要同時加進來。
# 跑 build-assets.py（不加 --public）會產出完整圖庫，🔴 那會把整套供應商圖
# 放進 public/，只能在本機看，不能部署。
PUBLIC_SET = {
    'vuca/editorial-bw.jpg', 'vuca/bedroom.jpg',
    'saintmari/scarf-camel-blazer.jpg', 'saintmari/scarf-mauve-pearl.jpg',
    'saintmari/scarf-pink-bow.jpg', 'saintmari/necklace-01.png',
}

# public/media/ 底下不是這支腳本產生的目錄。清空舊輸出時要跳過，
# 否則會刪掉手動放進去的素材（例如首頁輪播的手機包照片）
KEEP_DIRS = {'phonebag'}

# ── A. VUCA 型錄素材 ────────────────────────────────────────
# (輸出相對路徑, 來源檔, 遮罩檔或 None, 是否套影調)
VUCA_JOBS = [
    ('vuca/editorial-bw.jpg',  'img_obj007_620x731.png',   None,                      False),
    ('vuca/bedroom.jpg',       'img_obj020_1601x1068.jpg', None,                      False),
    ('vuca/set.png',           'img_obj074_800x800.jpg',   'mask_obj075_800x800.png', False),
    ('vuca/badge-best.png',    'img_obj076_252x270.jpg',   'mask_obj077_252x270.png', False),
    ('vuca/ylang.jpg',         'img_obj085_588x800.jpg',   None,                      True),
    ('vuca/blackcherry.jpg',   'img_obj086_551x800.jpg',   None,                      True),
    ('vuca/aquakiss.jpg',      'img_obj084_551x800.jpg',   None,                      True),
    ('vuca/flowershop.jpg',    'img_obj083_543x797.jpg',   None,                      True),
    ('vuca/aprilfresh.jpg',    'img_obj082_562x800.jpg',   None,                      True),
]

# ── B. SAINTMARI 絲巾與飾品：Excel 列號 → 品項 ───────────────
# 對應來源工作表：R2–R14 絲巾、R15–R20 絲巾扣、R21–R27 耳環、
#                    R28–R32 項鍊、R33–R37 戒指、R38–R42 手鍊
KIND_ROWS = [
    ('scarf', 2, 14),
    ('scarfring', 15, 20),
    ('earring', 21, 27),
    ('necklace', 28, 32),
    ('ring', 33, 37),
    ('bracelet', 38, 42),
]
ROW_KIND = {r: k for k, a, b in KIND_ROWS for r in range(a, b + 1)}
KIND_FIRST_ROW = {k: a for k, a, _ in KIND_ROWS}
KIND_SKU_COUNT = {k: b - a + 1 for k, a, b in KIND_ROWS}

# 高解析版的絲巾編輯照（Excel 內是縮圖，資料夾裡有大圖）
SCARF_HIRES = [
    ('saintmari/scarf-camel-blazer.jpg', '1.jpg'),
    ('saintmari/scarf-pink-bow.jpg',     '2.jpg'),
    ('saintmari/scarf-mauve-pearl.jpg',  '3.jpg'),
]


def house_tone(im):
    """Velora 統一影調。

    香調意象圖的原色是綠葉、紅櫻桃、藍海、桃紅花，四張並排在暖米白版面上會直接
    蓋過整頁的克制感。降到 45% 飽和並壓一層暖調後，四款仍可分辨（依然是綠/紅/藍/粉），
    但落回色票裡，和黑白主視覺構成一致的影像語言。跑 --raw 可還原原色。
    """
    if RAW:
        return im
    im = ImageEnhance.Color(im).enhance(0.45)
    r, g, b = im.split()
    r = r.point(lambda v: min(255, int(v * 1.06 + 6)))
    g = g.point(lambda v: min(255, int(v * 1.01 + 2)))
    b = b.point(lambda v: int(v * 0.93))
    im = Image.merge('RGB', (r, g, b))
    im = ImageEnhance.Brightness(im).enhance(1.03)
    return ImageEnhance.Contrast(im).enhance(1.06)


def fit(im, max_edge=MAX_EDGE):
    w, h = im.size
    if max(w, h) <= max_edge:
        return im
    s = max_edge / max(w, h)
    return im.resize((round(w * s), round(h * s)), Image.LANCZOS)


def save(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if path.endswith('.png'):
        im.save(path, 'PNG', optimize=True)
    else:
        im.convert('RGB').save(path, 'JPEG', quality=86, optimize=True, progressive=True)


def square_thumb(im, size=THUMB):
    """置中裁方，供後台清單 56px 縮圖欄使用。"""
    if im.mode == 'RGBA':
        bg = Image.new('RGB', im.size, (253, 251, 247))
        bg.paste(im, mask=im.getchannel('A'))
        im = bg
    im = im.convert('RGB')
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
    return im.resize((size, size), Image.LANCZOS)


def run(rel, src_path, mask_path=None, tone=False, quiet=False):
    im = Image.open(src_path)
    note = ''
    if mask_path:
        rgb = im.convert('RGB')
        alpha = Image.open(mask_path).convert('L')
        if alpha.size != rgb.size:
            alpha = alpha.resize(rgb.size, Image.LANCZOS)
        im = rgb.copy()
        im.putalpha(alpha)
        note = '去背合成'
    elif im.mode not in ('RGB', 'RGBA'):
        im = im.convert('RGBA' if 'A' in im.getbands() else 'RGB')

    if tone:
        if im.mode == 'RGBA':
            a = im.getchannel('A')
            im = house_tone(im.convert('RGB'))
            im.putalpha(a)
        else:
            im = house_tone(im.convert('RGB'))
        note = (note + ' 套影調').strip()

    im = fit(im)

    # 只有真的帶透明像素才留 PNG。來源裡多數 .png 其實是白底商品照，
    # 若原樣輸出，前端就無從分辨「去背圖」與「白底照」，版面會用錯裁切方式。
    if im.mode == 'RGBA' and im.getchannel('A').getextrema()[0] == 255:
        im = im.convert('RGB')
        rel = rel.rsplit('.', 1)[0] + '.jpg'
        note = (note + ' 無透明→JPEG').strip()

    if PUBLIC and rel not in PUBLIC_SET:
        return rel

    save(im, os.path.join(OUT, rel))
    if not PUBLIC:
        save(square_thumb(im), os.path.join(OUT, 'thumb',
                                            os.path.basename(rel).rsplit('.', 1)[0] + '.jpg'))
    if not quiet:
        print('  %-34s %4dx%-4d %s' % (rel, im.size[0], im.size[1], note))
    return rel


def main():
    # 盡力清空舊輸出；若有檔案被編輯器或預覽鎖住就跳過，後續會直接覆寫
    if os.path.isdir(OUT):
        locked = 0
        for base, _, files in os.walk(OUT, topdown=False):
            if os.path.relpath(base, OUT).replace(os.sep, '/').split('/')[0] in KEEP_DIRS:
                continue
            for f in files:
                try:
                    os.remove(os.path.join(base, f))
                except OSError:
                    locked += 1
            try:
                os.rmdir(base)
            except OSError:
                pass
        if locked:
            print('（%d 個舊檔被其他程式鎖住，將直接覆寫）' % locked)
    print('輸出到 %s%s\n' % (OUT, '   (--raw 原色)' if RAW else ''))

    print('VUCA 居家香氛')
    for rel, src, mask, tone in VUCA_JOBS:
        sp = os.path.join(EXTRACT, src)
        if not os.path.exists(sp):
            print('  缺少來源：%s' % src)
            continue
        run(rel, sp, os.path.join(EXTRACT, mask) if mask else None, tone)

    print('\nSAINTMARI 絲巾與飾品（高解析編輯照）')
    scarf_dir = os.path.join(SAMPLE, 'Jewelry accessories')
    manifest = {}
    for i, (rel, src) in enumerate(SCARF_HIRES, start=1):
        sp = os.path.join(scarf_dir, src)
        if not os.path.exists(sp):
            continue
        run(rel, sp)
        # 公開版的絲巾線就由這三張編輯照組成 —— Excel 內的絲巾縮圖不進公開集。
        # 完整版則由下方的 Excel 影像填滿 SKU 1–13，這裡就不佔號。
        if PUBLIC:
            manifest.setdefault('scarf', {})[i] = ['/media/' + rel]

    print('\nSAINTMARI 商品照（自 Excel 擷取，依列號對回 SKU）')
    if not os.path.isdir(XLSX_MEDIA):
        print('  找不到 %s，請先跑 xlsx 擷取。' % XLSX_MEDIA)
    else:
        # 同一列可能有多張圖；檔案大的當主圖（通常是完整商品照而非細節圖）
        by_row = {}
        for fn in os.listdir(XLSX_MEDIA):
            m = re.match(r'cell_[A-Z]+(\d+)_image\d+\.\w+$', fn)
            if m:
                by_row.setdefault(int(m.group(1)), []).append(fn)

        for row in sorted(by_row):
            kind = ROW_KIND.get(row)
            if not kind:
                continue
            # SKU 編號＝該列在同品項中的序位，缺照片的列直接留空號，不擠掉後面的
            sku = row - KIND_FIRST_ROW[kind] + 1
            files = sorted(by_row[row],
                           key=lambda f: -os.path.getsize(os.path.join(XLSX_MEDIA, f)))
            rels = []
            for i, fn in enumerate(files):
                ext = '.png' if fn.lower().endswith('.png') else '.jpg'
                rel = 'saintmari/%s-%02d%s%s' % (kind, sku, '' if i == 0 else '-%d' % (i + 1), ext)
                actual = run(rel, os.path.join(XLSX_MEDIA, fn), quiet=True)
                rels.append('/media/' + actual)
            rels = [r for r in rels if not PUBLIC or r.replace('/media/', '') in PUBLIC_SET]
            if rels:
                manifest.setdefault(kind, {})[sku] = rels

        for kind in ('scarf', 'scarfring', 'earring', 'necklace', 'ring', 'bracelet'):
            have = manifest.get(kind, {})
            total_sku = KIND_SKU_COUNT[kind]
            missing = [s for s in range(1, total_sku + 1) if s not in have]
            print('  %-10s %d/%d SKU 有照片%s'
                  % (kind, len(have), total_sku,
                     '（缺 %s）' % ', '.join('No.%02d' % s for s in missing) if missing else ''))

    # 2026-10-15 起不再輸出 media-manifest.js：前台從沒 import 過它，
    # 版面引用的固定素材寫在 ShowcaseView.vue，商品圖由 /api/catalog 給。

    total = sum(len(f) for _, _, f in os.walk(OUT))
    print('完成，共 %d 個圖檔。' % total)


if __name__ == '__main__':
    main()
