<template>
  <div class="gw-panel">
    <p class="page-desc">
      整编待办与井点列表、异常入口读取同一批次状态：批次成功提交时与汇总同次落库并产生一条待办，
      同一批次只出现一次；重复提交不会重建待办。整编中、已整编以及未成功提交的批次不在待办内。
    </p>

    <table class="data-table">
      <thead>
        <tr>
          <th>批次编号</th>
          <th>批次日期</th>
          <th>提交时间</th>
          <th>计划井点</th>
          <th>有效观测</th>
          <th>缺失井点</th>
          <th>批次状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="batch in store.todos" :key="batch.id">
          <td>{{ batch.batchNo }}</td>
          <td>{{ batch.batchDate }}</td>
          <td>{{ formatTime(batch.submittedAt) }}</td>
          <td>{{ batch.summary?.totalWells ?? '—' }}</td>
          <td>{{ batch.summary?.acceptedWells ?? '—' }}</td>
          <td>{{ (batch.summary?.missingWells ?? []).join('、') || '无' }}</td>
          <td>{{ batch.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="start(batch.id)">开始整编</button>
          </td>
        </tr>
        <tr v-if="!store.todos.length">
          <td colspan="8" class="empty-state">暂无整编待办，批次成功提交后会进入这里</td>
        </tr>
      </tbody>
    </table>

    <section v-if="compilingBatches.length" class="batch-card">
      <h3 class="sub-title">整编中</h3>
      <table class="data-table">
        <thead>
          <tr><th>批次编号</th><th>批次日期</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="batch in compilingBatches" :key="batch.id">
            <td>{{ batch.batchNo }}</td>
            <td>{{ batch.batchDate }}</td>
            <td>{{ batch.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="finish(batch.id)">完成整编</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span v-if="message" class="error-text">{{ message }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useGroundwaterStore } from '@/stores/groundwater'

const store = useGroundwaterStore()
const message = ref('')

const compilingBatches = computed(() =>
  store.batches.filter((batch) => batch.status === '整编中'),
)

function formatTime(value: number | null): string {
  if (value === null) {
    return '—'
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function start(batchId: string) {
  message.value = store.startCompilation(batchId).message
}

function finish(batchId: string) {
  message.value = store.finishCompilation(batchId).message
}
</script>
