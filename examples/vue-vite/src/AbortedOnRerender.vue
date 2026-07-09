<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

/**
 * Starts on a slow endpoint, then swaps to a valid image 300ms later.
 * The browser aborts the in-flight request and fires `error` — but nothing
 * is actually broken, so the reporter should discard it.
 */
const src = ref('/api/slow.png');
let timer: ReturnType<typeof setTimeout>;

onMounted(() => {
  timer = setTimeout(() => (src.value = '/ok.png'), 300);
});
onUnmounted(() => clearTimeout(timer));
</script>

<template>
  <img :src="src" alt="aborted mid-flight" />
</template>
