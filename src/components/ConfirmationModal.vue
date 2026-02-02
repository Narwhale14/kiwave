<script setup lang="ts">
defineProps<{ visible: boolean }>();
defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="fixed flex flex-col justify-center gap-2 z-50 bg-black p-3 rounded-md">
      <slot />

      <div class="flex items-center gap-2.5">
        <button class="w-6 h-6 justify-center hover:text-white hover:bg-red-600 rounded" @click="$emit('cancel')">
          <span class="pi pi-times"></span>
        </button>

        <button class="w-6 h-6 justify-center hover:text-white hover:bg-green-600 rounded" @click="$emit('confirm')">
          <span class="pi pi-check"></span>
        </button>
      </div>
    </div>
  </Teleport>
</template>
