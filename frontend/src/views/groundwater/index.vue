<template>
  <section class="page" data-module="groundwater">
    <header class="page-head">
      <div>
        <h2>地下水观测管理</h2>
        <p class="page-desc">
          以观测批次为核心，井点列表、异常处理、整编待办读取同一批次状态，围绕井点编号、观测日期、埋深值完成批次流转。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn ghost" type="button" @click="store.reset()">重置示例批次</button>
      </div>
    </header>

    <nav class="gw-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="gw-tab"
        :class="{ active: active === tab.key }"
        type="button"
        @click="active = tab.key"
      >
        {{ tab.label }}
        <span v-if="tab.key === 'todo' && todoCount" class="tab-badge">{{ todoCount }}</span>
        <span v-if="tab.key === 'abnormal' && abnormalCount" class="tab-badge abnormal">{{ abnormalCount }}</span>
      </button>
    </nav>

    <WellListTab v-if="active === 'wells'" />
    <AbnormalTab v-else-if="active === 'abnormal'" />
    <CompilationTodoTab v-else-if="active === 'todo'" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import AbnormalTab from './AbnormalTab.vue'
import CompilationTodoTab from './CompilationTodoTab.vue'
import WellListTab from './WellListTab.vue'
import { useGroundwaterStore } from '@/stores/groundwater'

const store = useGroundwaterStore()
const active = ref<'wells' | 'abnormal' | 'todo'>('wells')
const tabs = [
  { key: 'wells' as const, label: '井点列表' },
  { key: 'abnormal' as const, label: '异常处理' },
  { key: 'todo' as const, label: '整编待办' },
]

const todoCount = computed(() => store.todos.length)
const abnormalCount = computed(
  () => store.batches.filter((batch) => batch.status === '异常待处理').length,
)
</script>
