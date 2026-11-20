// AudioWorklet global scope may not provide `performance`. Official FluidSynth's
// Emscripten glue calls performance.now() during module / synth setup.
if (typeof globalThis.performance === 'undefined' || typeof globalThis.performance.now !== 'function') {
  const origin = Date.now();
  globalThis.performance = { now() { return Date.now() - origin; } };
}
