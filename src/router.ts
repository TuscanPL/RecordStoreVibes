import { createRouter, createWebHashHistory } from 'vue-router'
import LandingView from './views/LandingView.vue'
import BrowseView from './views/BrowseView.vue'
import PlayerView from './views/PlayerView.vue'
import FlaggedView from './views/FlaggedView.vue'
import SamplerView from './views/SamplerView.vue'

/**
 * Hash history: this deploys to GitHub Pages, which has no rewrite rules,
 * so a deep link to /r/:id under history mode would 404 on refresh.
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'landing', component: LandingView },
    { path: '/browse', name: 'browse', component: BrowseView },
    { path: '/r/:id', name: 'player', component: PlayerView, props: true },
    { path: '/r/:id/pads/:track', name: 'sampler', component: SamplerView, props: true },
    { path: '/flagged', name: 'flagged', component: FlaggedView },
    { path: '/:pathMatch(.*)*', redirect: '/browse' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
