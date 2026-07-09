import { computed, onScopeDispose, shallowRef } from 'vue';
import { brokenImageStore, type BrokenImageStore } from 'broken-image-reporter';

/**
 * The Vue counterpart of `broken-image-reporter/react`'s hook.
 *
 * The package ships no Vue binding — it does not need to. The store is a plain
 * subscribe/getSnapshot pair, so adapting it to any reactivity system is this
 * short. Copy this file into your own project.
 *
 * `shallowRef` is enough: the store never mutates a snapshot, it replaces it.
 */
export function useBrokenImageReport(store: BrokenImageStore = brokenImageStore) {
  const state = shallowRef(store.getSnapshot());

  const unsubscribe = store.subscribe(() => {
    state.value = store.getSnapshot();
  });
  onScopeDispose(unsubscribe);

  return {
    errors: computed(() => state.value.errors),
    count: computed(() => state.value.count),
    clearErrors: store.clearErrors,
    toJson: store.exportAsJson,
    toCsv: store.exportAsCsv,
  };
}
