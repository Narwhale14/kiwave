<script setup lang="ts">
import { snapDivision, snapOptions } from '../util/snap';
import BaseDropdown from './modals/BaseDropdown.vue';
</script>

<template>
  <div class="flex w-full border-2 bg-mix-15 border-mix-30 px-3 py-2">
    <label class="flex items-center gap-2 text-xs">
        <BaseDropdown
          v-model="snapDivision"
          :items="snapOptions"
          item-label="label"
          item-value="value"
          button-bg="bg-mix-25"
          width="20"
        />
      </label>
  </div>
</template>