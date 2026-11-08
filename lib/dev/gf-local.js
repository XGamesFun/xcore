// env.GF on this machine: the platform binding a game's server gets in `xcore dev` (gf-server-v1,
// ../server/contract.mjs GF_METHODS). It runs in workerd beside the game's server as a Workers RPC entrypoint, the way
// xgames.fun binds its platform (entrypoint GameServices) to a hosted game's server, with the same methods, arguments
// and answers. Every call goes to the dev host (the HOST binding, a function in Node: ./platform.mjs), which keeps saves
// and scores in the game's .gamesfun/dev-platform.json, checks its own local sign-in tokens, and prints loot reports.
// Nothing here reaches xgames.fun. Every answer is {ok: true, …} or {ok: false, code, why}; nothing throws.
import { WorkerEntrypoint, RpcTarget } from 'cloudflare:workers';

async function call(env, op, args) {
  try {
    const r = await env.HOST.fetch(`http://gf.local/${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    return await r.json();
  } catch (e) {
    return {
      ok: false,
      code: 'unavailable',
      why: `xcore dev's platform did not answer (${String(e?.message ?? e).slice(0, 120)}).`,
    };
  }
}

class Saves extends RpcTarget {
  #env;
  constructor(env) {
    super();
    this.#env = env;
  }
  get(player, key = 'main') {
    return call(this.#env, 'saves.get', [player, key]);
  }
  put(player, key, value) {
    return call(this.#env, 'saves.put', [player, key, value]);
  }
  delete(player, key) {
    return call(this.#env, 'saves.delete', [player, key]);
  }
  list(player) {
    return call(this.#env, 'saves.list', [player]);
  }
}
class Scores extends RpcTarget {
  #env;
  constructor(env) {
    super();
    this.#env = env;
  }
  submit(board, player, score, opts = {}) {
    return call(this.#env, 'scores.submit', [board, player, score, opts]);
  }
  setup(board, opts = {}) {
    return call(this.#env, 'scores.setup', [board, opts]);
  }
  top(board, opts = {}) {
    return call(this.#env, 'scores.top', [board, opts]);
  }
  best(board, player) {
    return call(this.#env, 'scores.best', [board, player]);
  }
  remove(board, player) {
    return call(this.#env, 'scores.remove', [board, player]);
  }
  drop(board) {
    return call(this.#env, 'scores.drop', [board]);
  }
}
class Loot extends RpcTarget {
  #env;
  constructor(env) {
    super();
    this.#env = env;
  }
  report(result) {
    return call(this.#env, 'loot.report', [result]);
  }
  status() {
    return call(this.#env, 'loot.status', []);
  }
}

export class GameServices extends WorkerEntrypoint {
  get saves() {
    return new Saves(this.env);
  }
  get scores() {
    return new Scores(this.env);
  }
  get loot() {
    return new Loot(this.env);
  }
  info() {
    return call(this.env, 'info', []);
  }
  verifyPlayer(token) {
    return call(this.env, 'verifyPlayer', [token]);
  }
}

export default {
  fetch() {
    return new Response('env.GF stand-in: bind it with { entrypoint: "GameServices" }', { status: 404 });
  },
};
