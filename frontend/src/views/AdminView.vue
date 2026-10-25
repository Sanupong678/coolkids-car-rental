<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import Icon from '@/components/ui/Icon.vue'
import DashboardPanel from '@/components/admin/DashboardPanel.vue'
import OperationsPanel from '@/components/admin/OperationsPanel.vue'
import FleetPanel from '@/components/admin/FleetPanel.vue'
import DataPanel from '@/components/admin/DataPanel.vue'
import SlipsPanel from '@/components/admin/SlipsPanel.vue'
import ApprovalsPanel from '@/components/admin/ApprovalsPanel.vue'
import ScheduleBoard from '@/components/admin/ScheduleBoard.vue'
import MaintenancePanel from '@/components/admin/MaintenancePanel.vue'
import AccountsPanel from '@/components/admin/AccountsPanel.vue'
import TripSharing from '@/components/admin/TripSharing.vue'
import { reportOnVisit } from '@/utils/staffLocation'

// Back office (role admin). A side rail switches pages (?tab=) and, on the
// dashboard, its views (?view=calendar|map|graph), so a refresh or a shared link
// lands on the same screen. Each tab is gated by the permission the API enforces.
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const TABS = [
  { key: 'dashboard', label: 'ภาพรวม', icon: 'grid', perm: 'analytics:read', comp: DashboardPanel },
  { key: 'schedule', label: 'ปฏิทินจอง', icon: 'calendar', perm: 'bookings:read', comp: ScheduleBoard },
  { key: 'operations', label: 'งานส่งรถ', icon: 'car', perm: 'bookings:read', comp: OperationsPanel },
  { key: 'approvals', label: 'ตรวจเอกสาร', icon: 'user', perm: 'users:read_sensitive', comp: ApprovalsPanel },
  { key: 'slips', label: 'ตรวจสลิป', icon: 'check', perm: 'payments:read', comp: SlipsPanel },
  { key: 'maintenance', label: 'ซ่อมบำรุง', icon: 'gauge', perm: 'maintenance:read', comp: MaintenancePanel },
  { key: 'fleet', label: 'จัดการรถ', icon: 'wrench', perm: 'vehicles:read', comp: FleetPanel },
  { key: 'admins', label: 'ผู้ดูแลระบบ', icon: 'users', perm: 'roles:manage', comp: AccountsPanel },
  { key: 'data', label: 'ข้อมูล', icon: 'receipt', perm: 'analytics:read', comp: DataPanel },
]
const VIEWS = [
  { key: 'calendar', label: 'ปฏิทิน', icon: 'calendar' },
  { key: 'map', label: 'แผนที่', icon: 'map' },
  { key: 'graph', label: 'กราฟ', icon: 'chart' },
]
// Collapsed (icons only) is remembered on this device.
const RAIL_KEY = 'ck.railCollapsed'
const collapsed = ref(false)
try {
  collapsed.value = localStorage.getItem(RAIL_KEY) === '1'
} catch {
  /* storage blocked: starts expanded */
}
function toggleRail() {
  collapsed.value = !collapsed.value
  try {
    localStorage.setItem(RAIL_KEY, collapsed.value ? '1' : '0')
  } catch {
    /* ignore */
  }
}
// The server says which pages this account may open (sub-admins: the pages the
// super admin ticked); older role-based accounts fall back to their permissions.
const tabs = computed(() => TABS.filter((t) => (auth.me?.adminPages ? auth.me.adminPages.includes(t.key) : auth.can(t.perm))))
const active = computed(() => tabs.value.find((t) => t.key === route.query.tab) ?? tabs.value[0])
const view = computed(() => (VIEWS.some((v) => v.key === route.query.view) ? route.query.view : 'calendar'))
const go = (key) => router.replace({ query: { tab: key } })
const goView = (key) => router.replace({ query: { tab: 'dashboard', view: key } })
const TITLES = { calendar: 'ปฏิทินส่งรถ', map: 'แผนที่ส่งรถ', graph: 'สถิติธุรกิจ' }

onMounted(() => {
  document.body.classList.add('admin-page')
  // Delivery staff: note where they are when they open the back office.
  if (auth.can('deliveries:update') || auth.can('deliveries:read')) reportOnVisit()
})
onBeforeUnmount(() => document.body.classList.remove('admin-page'))
</script>

<template>
  <main class="admin">
    <div class="wrap">
      <aside class="rail" :class="{ mini: collapsed }" aria-label="เมนูผู้ดูแล">
        <header class="rail-head">
          <strong v-if="!collapsed">Coolkids</strong>
          <button type="button" class="burger" :aria-expanded="!collapsed" :aria-label="collapsed ? 'ขยายเมนู' : 'ย่อเมนู'" @click="toggleRail">
            <Icon name="menu" :size="18" />
          </button>
        </header>
        <nav>
          <template v-for="t in tabs" :key="t.key">
            <button
              type="button"
              class="item"
              :class="{ on: active?.key === t.key }"
              :aria-current="active?.key === t.key ? 'page' : undefined"
              :title="collapsed ? t.label : undefined"
              @click="go(t.key)"
            >
              <Icon :name="t.icon" :size="18" />
              <span class="lbl" :class="{ hide: collapsed }">{{ t.label }}</span>
            </button>
            <ul v-if="t.key === 'dashboard' && active?.key === 'dashboard'" class="sub">
              <li v-for="v in VIEWS" :key="v.key">
                <button
                  type="button"
                  :class="{ on: view === v.key }"
                  :aria-current="view === v.key ? 'true' : undefined"
                  :title="collapsed ? v.label : undefined"
                  :aria-label="collapsed ? v.label : undefined"
                  @click="goView(v.key)"
                >
                  <Icon :name="v.icon" :size="14" /> <template v-if="!collapsed">{{ v.label }}</template>
                </button>
              </li>
            </ul>
          </template>
        </nav>
      </aside>

      <div class="content">
        <header class="top">
          <span class="eyebrow">Coolkids Back Office</span>
          <h1>{{ active?.key === 'dashboard' ? TITLES[view] : (active?.label ?? 'Admin') }}</h1>
        </header>
        <!-- drivers on a delivery: live GPS for the customer's map and arrival alerts -->
        <TripSharing v-if="auth.can('deliveries:update')" />
        <!-- phones: the dashboard views as a segmented switch (the side menu becomes a bottom tab bar) -->
        <div v-if="active?.key === 'dashboard'" class="views-m" role="tablist" aria-label="มุมมอง">
          <button v-for="v in VIEWS" :key="v.key" type="button" role="tab" :aria-selected="view === v.key" :class="{ on: view === v.key }" @click="goView(v.key)">
            <Icon :name="v.icon" :size="14" /> {{ v.label }}
          </button>
        </div>
        <component :is="active.comp" v-if="active" :key="active.key" v-bind="active.key === 'dashboard' ? { view, onView: goView } : {}" />
        <p v-else class="none">บัญชีนี้ไม่มีสิทธิ์เข้าถึงส่วนผู้ดูแล</p>
      </div>
    </div>
  </main>
</template>

<style scoped>
/* Loading placeholders on the dark back office: a faint glass shimmer, not the site's white card. */
.admin :deep(.skeleton) {
  background: linear-gradient(100deg, rgb(255 255 255 / 0.04) 30%, rgb(255 255 255 / 0.1) 50%, rgb(255 255 255 / 0.04) 70%);
  background-size: 300% 100%;
}
/* Dark frosted-glass back office over a blurred office photo. Every panel reads
   these tokens: surfaces are translucent and blur what is behind them; chart
   marks use a blue bright enough for the dark ground (text never wears it). */
.admin {
  --viz-surface: rgb(255 255 255 / 0.06);
  --viz-surface-strong: rgb(255 255 255 / 0.11);
  --viz-text: #f2f3f7;
  --viz-muted: rgb(222 226 238 / 0.62);
  --viz-grid: rgb(255 255 255 / 0.08);
  --viz-border: rgb(255 255 255 / 0.13);
  --viz-hover: rgb(255 255 255 / 0.06);
  --viz-tip-bg: #f2f3f7;
  --viz-tip-text: #121319;
  --viz-glass: blur(18px) saturate(140%);
  --viz-cream: #ece7dc;
  --viz-glow: #3d8bff;
  --series-1: #5b9dff;
  --ok: #5fd39a;
  --warn: #f3b664;
  --bad: #ff7f76;
  position: relative;
  isolation: isolate;
  min-height: 100dvh;
  padding: 84px clamp(12px, 2.4vw, 32px) 48px;
  color: var(--viz-text);
  color-scheme: dark;
  background: #0b1124;
}
.admin::before {
  /* fixed office photo (pre-blurred file), dimmed so light text on glass stays readable */
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  background:
    linear-gradient(180deg, rgb(8 11 22 / 0.55), rgb(8 11 22 / 0.72)),
    url('/admin/backdrop-office.webp') center / cover no-repeat,
    #0b1124;
}
.wrap {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 18px;
  max-width: 1680px;
  margin-inline: auto;
}
.content {
  display: grid;
  gap: 16px;
  min-width: 0;
}

/* ---- sidebar: frosted panel, title + menu toggle, icon + label rows */
.rail {
  position: sticky;
  top: 84px;
  width: 210px;
  display: grid;
  align-content: start;
  gap: 14px;
  min-height: min(620px, calc(100dvh - 110px));
  padding: 16px 12px;
  border: 1px solid rgb(255 255 255 / 0.16);
  border-radius: 22px;
  background: linear-gradient(180deg, rgb(255 255 255 / 0.12), rgb(255 255 255 / 0.05));
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  backdrop-filter: blur(24px) saturate(140%);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.12),
    0 20px 50px -30px rgb(0 0 0 / 0.7);
}
.rail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 4px 2px 8px;
}
.rail-head strong {
  font-size: 1.05rem;
  font-weight: 600;
}
.burger {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--viz-text);
  cursor: pointer;
}
.burger:hover {
  background: var(--viz-hover);
}
nav {
  display: grid;
  gap: 4px;
}
.item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: none;
  color: var(--viz-muted);
  font: inherit;
  font-size: 0.88rem;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.item:hover {
  background: rgb(255 255 255 / 0.06);
  color: var(--viz-text);
}
.item.on {
  border-color: rgb(255 255 255 / 0.14);
  background: rgb(255 255 255 / 0.14);
  color: #fff;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1);
}
.item:focus-visible,
.sub button:focus-visible,
.burger:focus-visible {
  outline: 2px solid var(--viz-cream);
  outline-offset: 2px;
}
.sub {
  display: grid;
  gap: 2px;
  margin: 2px 0 6px;
  padding: 0 0 0 22px;
  list-style: none;
  border-left: 1px solid rgb(255 255 255 / 0.14);
  margin-left: 20px;
}
.sub button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--viz-muted);
  font: inherit;
  font-size: 0.8rem;
  text-align: left;
  cursor: pointer;
}
.sub button:hover {
  color: var(--viz-text);
  background: var(--viz-hover);
}
.sub button.on {
  color: #fff;
  background: rgb(255 255 255 / 0.1);
}
/* collapsed: icons only */
.rail.mini {
  width: 68px;
  justify-items: center;
  padding-inline: 8px;
}
.rail.mini .rail-head {
  padding: 0;
}
.rail.mini .lbl.hide {
  display: none;
}
.rail.mini .item {
  justify-content: center;
  width: 44px;
  padding: 10px 0;
}
.rail.mini .sub {
  margin: 2px 0 6px;
  padding: 0;
  border: 0;
}
.rail.mini .sub button {
  justify-content: center;
  width: 36px;
  padding: 8px 0;
}

.top {
  display: grid;
}
.eyebrow {
  color: #ff8a82;
}
h1 {
  font-family: var(--font-body);
  font-size: var(--fs-2xl);
  font-weight: 700;
  letter-spacing: -0.01em;
}
.none {
  color: var(--viz-muted);
}

/* phones/tablets: the rail becomes a horizontal bar */
.views-m {
  display: none;
}

/* phones / small tablets: menu docks to the bottom like an app tab bar */
@media (max-width: 820px) {
  .admin {
    padding: 76px 12px calc(96px + env(safe-area-inset-bottom));
  }
  .wrap {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .rail,
  .rail.mini {
    position: fixed;
    inset: auto 10px calc(10px + env(safe-area-inset-bottom));
    z-index: 900;
    width: auto;
    min-height: 0;
    padding: 6px;
    border-radius: 22px;
    background: rgb(16 20 34 / 0.78);
  }
  .rail-head,
  .sub {
    display: none;
  }
  nav {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 4px;
  }
  .item,
  .rail.mini .item {
    flex-direction: column;
    justify-content: center;
    gap: 3px;
    width: auto;
    padding: 8px 4px;
    font-size: 0.7rem;
    text-align: center;
  }
  .item .lbl {
    display: block;
  }
  .views-m {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    padding: 4px;
    border: 1px solid var(--viz-border);
    border-radius: 14px;
    background: rgb(255 255 255 / 0.07);
    -webkit-backdrop-filter: var(--viz-glass);
    backdrop-filter: var(--viz-glass);
  }
  .views-m button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 38px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: var(--viz-muted);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .views-m button.on {
    background: var(--viz-cream);
    color: #15171e;
    font-weight: 600;
  }
  .eyebrow {
    display: none;
  }
  h1 {
    font-size: 1.5rem;
  }
}
</style>

<style>
body.admin-page {
  background: #0b1124;
}
/* Back-office form controls follow the glass theme (they live in several panels). */
.admin input:not([type='checkbox']):not([type='radio']):not([type='file']),
.admin select,
.admin textarea {
  color: var(--viz-text);
}
.admin select option {
  background: #161b2e;
  color: var(--viz-text);
}
.admin input[type='date']::-webkit-calendar-picker-indicator {
  filter: invert(1) opacity(0.7);
}
</style>
