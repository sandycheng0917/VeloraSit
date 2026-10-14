import { createRouter, createWebHistory } from 'vue-router'

import ShowcaseView from '@/views/ShowcaseView.vue'

/**
 * 公開版（VITE_PUBLIC_BUILD=1，即預設的 npm run build）不掛後台路由。
 *
 * 條件用的是 import.meta.env，Vite 會在建置時替換成字面值，
 * 整個 if 區塊連同 import() 都會被 tree-shaking 移除 ——
 * 公開的 bundle 裡不會有後台的任何一行程式碼或樣式。
 *
 * 那個 import 位於永遠為 false 的分支，Rollup 連解析都不會做（已實測）。
 *
 * 不要改用 import.meta.glob —— 它會在建置時就把模組表建好，
 * 導致後台被打包進公開版（踩過這個坑）。
 */
const IS_PUBLIC = import.meta.env.VITE_PUBLIC_BUILD === '1'

/**
 * 兩種建置產生兩個**獨立站台**，各自的根路由不同：
 *
 *   公開版（npm run build）        /  → 展示頁      部署在網站根 /
 *   後台版（npm run build:admin）  /  → 後台        部署在 /admin/
 *
 * 後台不是掛在展示站底下的一個子路徑。原本寫成 path: '/admin' 時，
 * 以 VITE_BASE=/admin/ 建置會讓 /admin/ 對到根路由（也就是展示頁），
 * 後台被推到 /admin/admin —— 打開後台會看到展示頁，而且沒有任何錯誤。
 * base 與路由路徑重複計算了同一段，是很容易漏掉的一種錯位。
 *
 * 分開的好處不只是路徑：後台的 bundle 裡連展示頁都不需要有。
 */
const routes = IS_PUBLIC
  ? [
      {
        path: '/',
        name: 'showcase',
        component: ShowcaseView,
        meta: { title: '維羅拉國際有限公司 | Velora International' },
      },
    ]
  : [
      {
        path: '/',
        name: 'admin',
        component: () => import('@/admin/AdminView.vue'),
        meta: { title: '商品管理 | 維羅拉' },
      },
    ]

routes.push({ path: '/:pathMatch(.*)*', redirect: '/' })

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, saved) {
    return saved || { top: 0 }
  },
})

router.afterEach((to) => {
  if (to.meta?.title) document.title = to.meta.title
})

export default router
