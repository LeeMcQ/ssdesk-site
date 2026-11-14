#!/usr/bin/env bash
# Compile official FluidSynth 2.6.2 (pinned source under src/fluidsynth-2.6.2)
# to a single JS+WASM file that can be loaded inside an AudioWorklet.
#
# Known-good recipe (Emscripten 7.0.0, 10 Nov 2026):
#   * Unset conda/sysroot CFLAGS — emcmake must see a clean env.
#   * Build only libfluidsynth.a (the fluidsynth CLI target fails to
#     link under emscripten because of pthread_setschedparam).
#   * Compile the C API as C, then link with em++ (FluidSynth 2.6 uses
#     a C++ filesystem OS).
#   * Provide a one-function stub for pthread_setschedparam.
#   * WITH_FLOAT stays off (double samples), Signalsmith stays off
#     (limiter is CLI-only; the page uses a DynamicsCompressor).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC="$ROOT/src/fluidsynth-2.6.2"
OUT="$ROOT/integration/ssdesk-fluidsynth/wasm/build"
LIBBUILD="$ROOT/src/build-wasm"
API="$ROOT/integration/ssdesk-fluidsynth/wasm/ssdesk_fluidsynth_api.c"
STUB="$ROOT/integration/ssdesk-fluidsynth/wasm/pthread_setschedparam_stub.c"

# Clean compiler flags from conda / micromamba so emcc uses its own sysroot.
unset CFLAGS CXXFLAGS CPPFLAGS LDFLAGS CMAKE_PREFIX_PATH CMAKE_C_COMPILER CMAKE_CXX_COMPILER
unset CPATH C_INCLUDE_PATH CPLUS_INCLUDE_PATH LIBRARY_PATH
# Keep PATH usable but prefer emsdk once sourced.
if [[ -f /tmp/emsdk/emsdk_env.sh ]]; then
  # shellcheck disable=SC1091
  source /tmp/emsdk/emsdk_env.sh
fi
command -v emcc >/dev/null && command -v emcmake >/dev/null || {
  echo "emcc/emcmake not on PATH. source emsdk_env.sh first." >&2
  exit 1
}

mkdir -p "$LIBBUILD" "$OUT"
cd "$LIBBUILD"
emcmake cmake -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -Denable-floats=OFF \
  -Denable-alsa=OFF -Denable-jack=OFF -Denable-pulseaudio=OFF -Denable-pipewire=OFF \
  -Denable-oss=OFF -Denable-dbus=OFF -Denable-ladspa=OFF -Denable-portaudio=OFF \
  -Denable-systemd=OFF -Denable-readline=OFF \
  -Denable-threads=OFF \
  -Denable-aufile=OFF \
  -Denable-libsndfile=OFF \
  -Denable-ipv6=OFF -Denable-network=OFF \
  -Denable-opensles=OFF -Denable-oboe=OFF \
  -Denable-openmp=OFF \
  -Denable-signalsmith=OFF \
  -Denable-dsound=OFF -Denable-waveout=OFF -Denable-wasapi=OFF -Denable-winmidi=OFF \
  "$SRC"

# Static library only — do not link the fluidsynth executable.
ninja libfluidsynth

LIB="$LIBBUILD/src/libfluidsynth.a"
INC="-I$SRC/include -I$LIBBUILD/include -I$LIBBUILD"

# 256 MiB initial heap so FluidR3_GM.sf2 (~148 MB) can be written into MEMFS
# plus synth state. Memory can grow to 1 GiB. Mobile should use the SF3 fallback.
EXPORTS='["_malloc","_free","_ss_fs_new","_ss_fs_delete","_ss_fs_sfload","_ss_fs_noteon","_ss_fs_noteoff","_ss_fs_cc","_ss_fs_program","_ss_fs_bank","_ss_fs_pitchbend","_ss_fs_all_notes_off","_ss_fs_all_sounds_off","_ss_fs_system_reset","_ss_fs_set_gain","_ss_fs_set_interp","_ss_fs_set_reverb","_ss_fs_set_chorus","_ss_fs_render_f32","_ss_fs_cc_get","_ss_fs_player_load","_ss_fs_player_play","_ss_fs_player_stop","_ss_fs_player_seek","_ss_fs_player_status","_ss_fs_player_get_ticks","_ss_fs_player_set_rate"]'

emcc -c -O3 -std=gnu11 "$STUB" -o "$OUT/pthread_setschedparam_stub.o"
emcc -c -O3 -std=gnu11 $INC "$API" -o "$OUT/ssdesk_fluidsynth_api.o"

# Link with em++ because libfluidsynth 2.6 pulls in C++.
em++ -O3 \
  "$OUT/ssdesk_fluidsynth_api.o" \
  "$OUT/pthread_setschedparam_stub.o" \
  "$LIB" \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=createFluidSynthModule \
  -sENVIRONMENT=web,worker \
  -sSINGLE_FILE=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=268435456 \
  -sMAXIMUM_MEMORY=1073741824 \
  -sFILESYSTEM=1 \
  -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","lengthBytesUTF8","FS","HEAPF32","HEAPU8","HEAP32","getValue","setValue"]' \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sSTACK_SIZE=1MB \
  -sASSERTIONS=0 \
  -o "$OUT/fluidsynth-2.6.2.mjs"

echo "Wrote $OUT/fluidsynth-2.6.2.mjs"
ls -lh "$OUT/fluidsynth-2.6.2.mjs"
sha256sum "$OUT/fluidsynth-2.6.2.mjs"
