/** React Native's abort-controller implements aborted but not throwIfAborted. */
export function throwIfNativeAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw Object.assign(new Error('Observation cancelled.'), { name: 'AbortError' });
}
