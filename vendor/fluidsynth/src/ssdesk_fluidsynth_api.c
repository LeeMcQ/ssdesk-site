/* Minimal C API around official FluidSynth 2.6.2, for a browser AudioWorklet.
 * LGPL-2.1-or-later, same as FluidSynth itself. See licenses/NOTICE.
 */
#include <fluidsynth.h>
#include <stdlib.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

typedef struct {
    fluid_settings_t *settings;
    fluid_synth_t *synth;
    fluid_player_t *player;
    int sfont_id;
} ss_fs_t;

EXPORT ss_fs_t *ss_fs_new(double sample_rate, int polyphony, int interp)
{
    ss_fs_t *ctx = (ss_fs_t *)calloc(1, sizeof(ss_fs_t));
    if(!ctx) return NULL;
    ctx->settings = new_fluid_settings();
    ctx->sfont_id = -1;
    if(!ctx->settings) { free(ctx); return NULL; }
    fluid_settings_setnum(ctx->settings, "synth.sample-rate", sample_rate);
    fluid_settings_setint(ctx->settings, "synth.polyphony", polyphony > 0 ? polyphony : 256);
    fluid_settings_setint(ctx->settings, "synth.cpu-cores", 1);
    fluid_settings_setint(ctx->settings, "synth.threadsafe-api", 0);
    fluid_settings_setstr(ctx->settings, "synth.reverb.engine", "dat");
    fluid_settings_setint(ctx->settings, "synth.reverb.active", 1);
    fluid_settings_setint(ctx->settings, "synth.chorus.active", 1);
    /* Conservative master gain; JS gain node does user volume. */
    fluid_settings_setnum(ctx->settings, "synth.gain", 0.35);
    ctx->synth = new_fluid_synth(ctx->settings);
    if(!ctx->synth) {
        delete_fluid_settings(ctx->settings);
        free(ctx);
        return NULL;
    }
    /* 7 = FLUID_INTERP_HIGHEST (25th-order sinc in 2.6.2). 6 = HIGH (17th). */
    fluid_synth_set_interp_method(ctx->synth, -1, interp);
    return ctx;
}

EXPORT void ss_fs_delete(ss_fs_t *ctx)
{
    if(!ctx) return;
    if(ctx->player) { delete_fluid_player(ctx->player); ctx->player=NULL; }
    if(ctx->synth) delete_fluid_synth(ctx->synth);
    if(ctx->settings) delete_fluid_settings(ctx->settings);
    free(ctx);
}

EXPORT int ss_fs_sfload(ss_fs_t *ctx, const char *path)
{
    if(!ctx || !ctx->synth || !path) return -1;
    ctx->sfont_id = fluid_synth_sfload(ctx->synth, path, 1);
    return ctx->sfont_id;
}

EXPORT int ss_fs_noteon(ss_fs_t *ctx, int ch, int key, int vel)
{
    return fluid_synth_noteon(ctx->synth, ch, key, vel);
}
EXPORT int ss_fs_noteoff(ss_fs_t *ctx, int ch, int key)
{
    return fluid_synth_noteoff(ctx->synth, ch, key);
}
EXPORT int ss_fs_cc(ss_fs_t *ctx, int ch, int ctrl, int val)
{
    return fluid_synth_cc(ctx->synth, ch, ctrl, val);
}
EXPORT int ss_fs_program(ss_fs_t *ctx, int ch, int program)
{
    return fluid_synth_program_change(ctx->synth, ch, program);
}
EXPORT int ss_fs_bank(ss_fs_t *ctx, int ch, int bank)
{
    return fluid_synth_bank_select(ctx->synth, ch, (unsigned)bank);
}
EXPORT int ss_fs_pitchbend(ss_fs_t *ctx, int ch, int value)
{
    return fluid_synth_pitch_bend(ctx->synth, ch, value);
}
EXPORT int ss_fs_all_notes_off(ss_fs_t *ctx, int ch)
{
    return fluid_synth_all_notes_off(ctx->synth, ch);
}
EXPORT int ss_fs_all_sounds_off(ss_fs_t *ctx, int ch)
{
    return fluid_synth_all_sounds_off(ctx->synth, ch);
}
EXPORT int ss_fs_system_reset(ss_fs_t *ctx)
{
    return fluid_synth_system_reset(ctx->synth);
}

EXPORT int ss_fs_player_load(ss_fs_t *ctx, const unsigned char *data, int len)
{
    if(!ctx || !ctx->synth || !data || len<=0) return -1;
    if(ctx->player) { delete_fluid_player(ctx->player); ctx->player = NULL; }
    ctx->player = new_fluid_player(ctx->synth);
    if(!ctx->player) return -1;
    if(fluid_player_add_mem(ctx->player, (const void *)data, len) != FLUID_OK) return -1;
    return 0;
}
EXPORT int ss_fs_player_play(ss_fs_t *ctx)
{
    return ctx && ctx->player ? fluid_player_play(ctx->player) : -1;
}
EXPORT int ss_fs_player_stop(ss_fs_t *ctx)
{
    return ctx && ctx->player ? fluid_player_stop(ctx->player) : -1;
}
EXPORT int ss_fs_player_seek(ss_fs_t *ctx, int ticks)
{
    return ctx && ctx->player ? fluid_player_seek(ctx->player, ticks) : -1;
}
EXPORT int ss_fs_player_status(ss_fs_t *ctx)
{
    return ctx && ctx->player ? fluid_player_get_status(ctx->player) : -1;
}
EXPORT int ss_fs_player_get_ticks(ss_fs_t *ctx)
{
    return ctx && ctx->player ? fluid_player_get_current_tick(ctx->player) : 0;
}
EXPORT void ss_fs_player_set_rate(ss_fs_t *ctx, double rate)
{
    if(!ctx || !ctx->player) return;
    /* FLUID_PLAYER_TEMPO_INTERNAL (0): tempo is a multiplier on the MIDI file
     * tempo (0.001–1000). FluidSynth 2.6.2 has no EXTERNAL_RATIO; enum 2 is
     * EXTERNAL_MIDI in microseconds per quarter-note, which made rate=1 play
     * the whole file in a few milliseconds. */
    if(rate < 0.001) rate = 0.001;
    if(rate > 1000.0) rate = 1000.0;
    fluid_player_set_tempo(ctx->player, 0, rate);
}
EXPORT void ss_fs_set_gain(ss_fs_t *ctx, double gain)
{
    fluid_settings_setnum(ctx->settings, "synth.gain", gain);
}
EXPORT void ss_fs_set_interp(ss_fs_t *ctx, int interp)
{
    fluid_synth_set_interp_method(ctx->synth, -1, interp);
}
EXPORT void ss_fs_set_reverb(ss_fs_t *ctx, int on, double room, double damp, double width, double level)
{
    fluid_settings_setint(ctx->settings, "synth.reverb.active", on ? 1 : 0);
    fluid_settings_setnum(ctx->settings, "synth.reverb.room-size", room);
    fluid_settings_setnum(ctx->settings, "synth.reverb.damp", damp);
    fluid_settings_setnum(ctx->settings, "synth.reverb.width", width);
    fluid_settings_setnum(ctx->settings, "synth.reverb.level", level);
}
EXPORT void ss_fs_set_chorus(ss_fs_t *ctx, int on, int nr, double level, double speed, double depth)
{
    fluid_settings_setint(ctx->settings, "synth.chorus.active", on ? 1 : 0);
    fluid_settings_setint(ctx->settings, "synth.chorus.nr", nr);
    fluid_settings_setnum(ctx->settings, "synth.chorus.level", level);
    fluid_settings_setnum(ctx->settings, "synth.chorus.speed", speed);
    fluid_settings_setnum(ctx->settings, "synth.chorus.depth", depth);
}
EXPORT int ss_fs_render_f32(ss_fs_t *ctx, float *left, float *right, int frames)
{
    /* Planar float, as AudioWorklet process() provides. */
    return fluid_synth_write_float(ctx->synth, frames, left, 0, 1, right, 0, 1);
}
EXPORT int ss_fs_cc_get(ss_fs_t *ctx, int ch, int ctrl)
{
    int v = 0;
    fluid_synth_get_cc(ctx->synth, ch, ctrl, &v);
    return v;
}
