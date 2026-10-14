<script setup>
/**
 * LINE 官方帳號 QR —— 真實可掃描碼。
 *
 * 由 https://lin.ee/uzoQ8dl 產生（QR 版本 2，容錯等級 M）。
 * 若日後換 LINE 帳號，重跑產碼流程並替換下方 PATH 即可：
 *   python -m pip install qrcode
 *   python -c "import qrcode;q=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M,border=0);q.add_data('<新網址>');q.make(fit=True);print(q.get_matrix())"
 */
defineProps({ size: { type: Number, default: 112 } })

const MODULES = 25
const PATH =
  'M0 0h7v1h-7zM8 0h1v1h-1zM10 0h2v1h-2zM14 0h1v1h-1zM18 0h7v1h-7zM0 1h1v1h-1zM6 1h1v1h-1zM8 1h1v1h-1zM10 1h3v1h-3zM18 1h1v1h-1zM24 1h1v1h-1zM0 2h1v1h-1zM2 2h3v1h-3zM6 2h1v1h-1zM8 2h1v1h-1zM10 2h2v1h-2zM13 2h2v1h-2zM16 2h1v1h-1zM18 2h1v1h-1zM20 2h3v1h-3zM24 2h1v1h-1zM0 3h1v1h-1zM2 3h3v1h-3zM6 3h1v1h-1zM10 3h3v1h-3zM15 3h1v1h-1zM18 3h1v1h-1zM20 3h3v1h-3zM24 3h1v1h-1zM0 4h1v1h-1zM2 4h3v1h-3zM6 4h1v1h-1zM8 4h1v1h-1zM11 4h1v1h-1zM16 4h1v1h-1zM18 4h1v1h-1zM20 4h3v1h-3zM24 4h1v1h-1zM0 5h1v1h-1zM6 5h1v1h-1zM10 5h1v1h-1zM12 5h1v1h-1zM18 5h1v1h-1zM24 5h1v1h-1zM0 6h7v1h-7zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h7v1h-7zM9 7h1v1h-1zM12 7h2v1h-2zM16 7h1v1h-1zM0 8h1v1h-1zM3 8h6v1h-6zM10 8h2v1h-2zM15 8h1v1h-1zM17 8h1v1h-1zM20 8h1v1h-1zM22 8h3v1h-3zM3 9h2v1h-2zM8 9h2v1h-2zM11 9h1v1h-1zM13 9h1v1h-1zM15 9h1v1h-1zM19 9h5v1h-5zM0 10h3v1h-3zM6 10h2v1h-2zM9 10h1v1h-1zM14 10h4v1h-4zM20 10h2v1h-2zM24 10h1v1h-1zM3 11h2v1h-2zM7 11h1v1h-1zM10 11h2v1h-2zM15 11h1v1h-1zM18 11h7v1h-7zM1 12h1v1h-1zM3 12h5v1h-5zM9 12h3v1h-3zM16 12h1v1h-1zM18 12h2v1h-2zM24 12h1v1h-1zM0 13h1v1h-1zM4 13h2v1h-2zM7 13h3v1h-3zM12 13h4v1h-4zM20 13h1v1h-1zM23 13h1v1h-1zM0 14h2v1h-2zM3 14h2v1h-2zM6 14h1v1h-1zM9 14h2v1h-2zM13 14h3v1h-3zM17 14h1v1h-1zM20 14h5v1h-5zM0 15h1v1h-1zM3 15h1v1h-1zM8 15h3v1h-3zM12 15h1v1h-1zM14 15h1v1h-1zM19 15h1v1h-1zM21 15h2v1h-2zM24 15h1v1h-1zM0 16h1v1h-1zM2 16h1v1h-1zM4 16h1v1h-1zM6 16h2v1h-2zM9 16h1v1h-1zM11 16h3v1h-3zM15 16h6v1h-6zM22 16h2v1h-2zM8 17h1v1h-1zM11 17h1v1h-1zM13 17h1v1h-1zM16 17h1v1h-1zM20 17h1v1h-1zM22 17h2v1h-2zM0 18h7v1h-7zM8 18h3v1h-3zM12 18h2v1h-2zM16 18h1v1h-1zM18 18h1v1h-1zM20 18h1v1h-1zM24 18h1v1h-1zM0 19h1v1h-1zM6 19h1v1h-1zM8 19h1v1h-1zM11 19h1v1h-1zM13 19h4v1h-4zM20 19h1v1h-1zM0 20h1v1h-1zM2 20h3v1h-3zM6 20h1v1h-1zM8 20h2v1h-2zM11 20h1v1h-1zM13 20h1v1h-1zM15 20h6v1h-6zM23 20h2v1h-2zM0 21h1v1h-1zM2 21h3v1h-3zM6 21h1v1h-1zM8 21h3v1h-3zM12 21h5v1h-5zM18 21h1v1h-1zM23 21h2v1h-2zM0 22h1v1h-1zM2 22h3v1h-3zM6 22h1v1h-1zM10 22h2v1h-2zM13 22h1v1h-1zM17 22h1v1h-1zM20 22h5v1h-5zM0 23h1v1h-1zM6 23h1v1h-1zM10 23h4v1h-4zM19 23h2v1h-2zM22 23h3v1h-3zM0 24h7v1h-7zM8 24h1v1h-1zM10 24h4v1h-4zM16 24h2v1h-2zM21 24h1v1h-1zM24 24h1v1h-1z'
</script>

<template>
  <svg
    class="qr"
    :width="size"
    :height="size"
    :viewBox="`0 0 ${MODULES} ${MODULES}`"
    shape-rendering="crispEdges"
    role="img"
    aria-label="LINE 官方帳號 QR Code"
  >
    <rect :width="MODULES" :height="MODULES" fill="#FDF9F6" />
    <path :d="PATH" fill="#1E1E1E" />
  </svg>
</template>

<style scoped>
.qr {
  display: block;
}
</style>
