import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import { useAppStore } from '../stores/app.js'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../pages/LoginPage.vue'),
    meta: { public: true, guestOnly: true },
  },
  {
    path: '/invite/:slug',
    name: 'public-invite',
    component: () => import('../pages/PublicInvitePage.vue'),
    meta: { public: true },
  },
  {
    path: '/meu-perfil',
    name: 'my-profile',
    component: () => import('../pages/ProfilePage.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('../layouts/MainLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'home', component: () => import('../pages/HomePage.vue') },
      { path: 'contacts', name: 'contacts', component: () => import('../pages/ContactsPage.vue') },
      { path: 'templates', name: 'templates', component: () => import('../pages/TemplatesPage.vue') },
      { path: 'notifications', name: 'notifications', component: () => import('../pages/NotificationsPage.vue') },
      { path: 'telegram', name: 'telegram', component: () => import('../pages/TelegramPage.vue'), meta: { channel: 'telegram' } },
      { path: 'whatsapp-web', name: 'whatsapp-web', component: () => import('../pages/WhatsappWebPage.vue'), meta: { channel: 'whatsappWeb' } },
      { path: 'whatsapp-cloud', name: 'whatsapp-cloud', component: () => import('../pages/WhatsappCloudPage.vue') },
      { path: 'email', name: 'email', component: () => import('../pages/EmailPage.vue'), meta: { channel: 'email' } },
      { path: 'invites', name: 'invites', component: () => import('../pages/InvitesPage.vue') },
      { path: 'terms', name: 'terms', component: () => import('../pages/TermsPage.vue') },
      { path: 'logins', name: 'profile-logins', component: () => import('../pages/LoginSettingsPage.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('../pages/NotFoundPage.vue'), meta: { public: true } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.bootstrap()

  if (to.meta.guestOnly && auth.isAuthenticated) return { name: 'home' }
  if (!to.meta.public && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if (to.meta.channel) {
    const app = useAppStore()
    await app.fetchStatus(to.meta.channel === 'whatsappWeb')
    if (!app.isChannelEnabled(to.meta.channel)) {
      return { name: 'home', query: { unavailable: to.meta.channel } }
    }
  }
})

export default router
