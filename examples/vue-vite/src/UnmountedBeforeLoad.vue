<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

/** Unmounts before the slow request finishes. Also not a real failure. */
const show = ref(true);

// Bound rather than static: Vue's SFC compiler rewrites a literal `src` into an
// asset import, which Vite then fails to resolve for a server-only route.
const src = '/api/slow.png?unmount';
let timer: ReturnType<typeof setTimeout>;

onMounted(() => {
  timer = setTimeout(() => (show.value = false), 300);
});
onUnmounted(() => clearTimeout(timer));
</script>

<template>
  <img v-if="show" :src="src" alt="unmounted" />
  <span v-else>unmounted</span>
</template>
