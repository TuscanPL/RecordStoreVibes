import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './style.css'

createApp(App).use(createPinia()).use(router).mount('#app')

// Offline shell. Failure is fine — it only ever removes a nicety, and
// private browsing and insecure origins both reject registration.
if ('serviceWorker' in navigator) {
  /*
   * Whether a worker was already driving this page.
   *
   * On a first ever visit the worker claims a page that had none, which
   * fires controllerchange too — reloading there would bounce the very
   * first launch for nothing.
   */
  const hadController = !!navigator.serviceWorker.controller
  let reloading = false

  /*
   * A new build normally takes two launches to appear: the first fetches
   * it and installs the worker, the second actually runs it. That made
   * fixes look like they hadn't shipped. Reloading the moment the new
   * worker takes control collapses it back to one.
   */
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(reg => {
        // Standalone apps can sit for days without a navigation, so ask.
        reg.update().catch(() => {})
      })
      .catch(() => {})
  })
}
