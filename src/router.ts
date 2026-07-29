import { createRouter, createWebHashHistory } from 'vue-router'
import BrowseView from './views/BrowseView.vue'
import PlayerView from './views/PlayerView.vue'
import FlaggedView from './views/FlaggedView.vue'

/**
 * Hash history: this deploys to GitHub Pages, which has no rewrite rules,
 * so a deep link to /r/:id under history mode would 404 on refresh.
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'browse', component: BrowseView },
    { path: '/r/:id', name: 'player', component: PlayerView, props: true },
    { path: '/flagged', name: 'flagged', component: FlaggedView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
