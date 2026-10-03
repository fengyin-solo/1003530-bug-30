<template>
  <div class="gw-panel">
    <p class="page-desc">
      异常处理读取同一批次状态：批次内观测被判异后整批挂起，恢复必须在批次上统一进行，
      重复记录不能各自恢复。恢复后回到采集中，不会直接变成已完成。
    </p>

    <article v-for="batch in abnormalBatches" :key="batch.id" class="batch-card">
      <header class="batch-head">
        <div>
          <strong>批次 {{ batch.batchNo }}</strong>
          <span class="batch-date">批次日期 {{ batch.batchDate }}</span>
          <span class="status-tag tag-abnormal">{{ batch.status }}</span>
        </div>
        <div class="row-actions">
          <button
            v-if="batch.status === '异常待处理'"
            class="btn primary"
            type="button"
            @click="recover(batch.id)"
          >整批恢复</button>
        </div>
      </header>

      <table class="data-table">
        <thead>
          <tr>
            <th>记录编号</th>
            <th>井点编号</th>
            <th>观测日期</th>
            <th>埋深值(米)</th>
            <th>观测人</th>
            <th>异常状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in abnormalRows(batch.id)" :key="row.id">
            <td>{{ row.recordNo }}</td>
            <td>{{ row.wellCode }}</td>
            <td>{{ row.observedOn || batch.batchDate }}</td>
            <td>{{ row.depth }}</td>
            <td>{{ row.observer || '—' }}</td>
            <td>异常待处理</td>
          </tr>
        </tbody>
      </table>
      <p class="batch-note">
        本批次 {{ abnormalRows(batch.id).length }} 条异常观测将随整批恢复一次性清除；不支持单条记录自行恢复。
      </p>
    </article>

    <div v-if="!abnormalBatches.length" class="batch-card empty-state">当前没有异常待处理的批次</div>

    <footer class="page-foot">
      <span v-if="message" class="error-text">{{ message }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { effectiveObservations } from '@/data/groundwater/batch-logic'
import type { GroundwaterObservation } from '@/data/groundwater/types'
import { useGroundwaterStore } from '@/stores/groundwater'

const store = useGroundwaterStore()
const message = ref('')

// 只有真正处于异常待处理的批次进入入口，避免同批次重复展示。
const abnormalBatches = computed(() =>
  store.batches.filter((batch) => batch.status === '异常待处理'),
)

function abnormalRows(batchId: string): GroundwaterObservation[] {
  const batch = store.batches.find((item) => item.id === batchId)
  if (!batch) {
    return []
  }
  // 只暴露去重后仍有效的异常观测，被覆盖的旧份不会冒出来。
  return effectiveObservations(batch).filter((row) => row.abnormal)
}

function recover(batchId: string) {
  message.value = store.recover(batchId).message
}
</script>
