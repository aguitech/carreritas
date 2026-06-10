// multiplayer.js — Capa P2P con PeerJS para carreritas
// API pública: MP.create({name, carId, color}) → {id, peers, send, onMessage, onPeerJoin, onPeerLeave, onReady, destroy}

const PEERJS_CDN = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const PEERJS_HOST = '0.peerjs.com'; // broker público por default
const PEERJS_PORT = 443;
const PEERJS_PATH = '/';
const ROOM_PREFIX = 'carreritas-2026-';

// Carga lazy del script PeerJS (solo cuando hace falta)
let _peerJsLoading = null;
function loadPeerJS() {
  if (window.Peer) return Promise.resolve();
  if (_peerJsLoading) return _peerJsLoading;
  _peerJsLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PEERJS_CDN;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar PeerJS desde CDN'));
    document.head.appendChild(s);
  });
  return _peerJsLoading;
}

function genRoomCode(len = 5) {
  // Sin 0/O/1/I/L para que sea fácil de dictar
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const MP = {
  // Crear sala (host)
  async create(opts = {}) {
    await loadPeerJS();
    const myName = opts.name || 'Host';
    const code = genRoomCode();
    const peerId = ROOM_PREFIX + code;
    const peer = new Peer(peerId, {
      host: PEERJS_HOST, port: PEERJS_PORT, path: PEERJS_PATH,
      debug: 1,
    });

    const state = {
      role: 'host',
      code,
      myId: peerId,
      myName,
      carId: opts.carId ?? 0,
      color: opts.color ?? 0xff2244,
      peer,
      connections: new Map(), // connId -> {conn, name, carId, color, lastSeen}
      roster: [],             // [{id, name, carId, color, isHost}]
      handlers: {
        message: new Map(),   // type -> Set<fn>
        peerJoin: new Set(),
        peerLeave: new Set(),
        roster: new Set(),
        ready: new Set(),
        error: new Set(),
      },
    };

    function emit(type, ...args) {
      const set = state.handlers[type];
      if (!set) return;
      set.forEach((fn) => { try { fn(...args); } catch (e) { console.error('MP handler error', e); } });
    }
    function on(type, fn) {
      if (!state.handlers[type]) state.handlers[type] = new Set();
      state.handlers[type].add(fn);
    }

    function addToRoster(entry) {
      const existing = state.roster.findIndex(r => r.id === entry.id);
      if (existing >= 0) state.roster[existing] = entry;
      else state.roster.push(entry);
      emit('roster', state.roster);
    }

    function removeFromRoster(id) {
      state.roster = state.roster.filter(r => r.id !== id);
      emit('roster', state.roster);
    }

    function broadcast(msg, exceptId = null) {
      const data = JSON.stringify(msg);
      state.connections.forEach((c, id) => {
        if (id === exceptId) return;
        if (c.conn.open) {
          try { c.conn.send(data); } catch (e) {}
        }
      });
    }

    function onMessage(msg, fromId) {
      if (!msg || typeof msg !== 'object') return;
      const type = msg.type;
      if (type === 'hello') {
        // Un cliente se presenta. Le mandamos roster completo + nuestro hello.
        const conn = state.connections.get(fromId);
        if (!conn) return;
        conn.name = msg.name || 'Invitado';
        conn.carId = msg.carId ?? 0;
        conn.color = msg.color ?? 0xffffff;
        // Responder hello con todos los datos
        const helloBack = {
          type: 'hello-back',
          hostName: state.myName,
          hostCarId: state.carId,
          hostColor: state.color,
          roster: state.roster.map(r => ({ ...r })),
        };
        try { conn.conn.send(JSON.stringify(helloBack)); } catch (e) {}
        // Anunciar a todos que hay un nuevo jugador
        addToRoster({ id: fromId, name: conn.name, carId: conn.carId, color: conn.color, isHost: false });
        broadcast({ type: 'peer-join', id: fromId, name: conn.name, carId: conn.carId, color: conn.color }, fromId);
        emit('peerJoin', { id: fromId, name: conn.name, carId: conn.carId, color: conn.color });
      } else if (type === 'state') {
        // update de física de un cliente
        const conn = state.connections.get(fromId);
        if (conn) conn.lastSeen = performance.now();
        emit('message', msg, fromId);
      } else if (type === 'lap-finish') {
        emit('message', msg, fromId);
        broadcast({ type: 'lap-finish', id: fromId, ms: msg.ms, lap: msg.lap }, fromId);
      } else if (type === 'ready') {
        emit('message', msg, fromId);
      } else {
        emit('message', msg, fromId);
      }
    }

    function bindConn(conn) {
      const connId = conn.peer;
      state.connections.set(connId, { conn, name: '?', lastSeen: performance.now() });
      conn.on('open', () => {
        // Pedir al cliente que se identifique
        try { conn.send(JSON.stringify({ type: 'identify' })); } catch (e) {}
      });
      conn.on('data', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }
        onMessage(msg, connId);
      });
      conn.on('close', () => {
        const c = state.connections.get(connId);
        state.connections.delete(connId);
        removeFromRoster(connId);
        broadcast({ type: 'peer-leave', id: connId }, connId);
        emit('peerLeave', { id: connId, name: c?.name });
      });
      conn.on('error', (e) => {
        console.warn('MP conn error', e);
      });
    }

    return new Promise((resolve, reject) => {
      peer.on('open', () => {
        // El host aparece primero en el roster
        addToRoster({ id: peerId, name: state.myName, carId: state.carId, color: state.color, isHost: true });
        peer.on('connection', (conn) => bindConn(conn));
        // Listo
        const api = {
          id: peerId,
          code,
          role: 'host',
          myName: state.myName,
          roster: state.roster,
          on,
          send(msg) { broadcast(msg); },
          sendTo(targetId, msg) {
            const c = state.connections.get(targetId);
            if (c && c.conn.open) {
              try { c.conn.send(JSON.stringify(msg)); } catch (e) {}
            }
          },
          destroy() {
            state.connections.forEach((c) => { try { c.conn.close(); } catch (e) {} });
            try { peer.destroy(); } catch (e) {}
          },
        };
        emit('ready', api);
        resolve(api);
      });
      peer.on('error', (err) => {
        console.error('Peer error:', err);
        emit('error', err);
        // Si es "unavailable-id" o "network", reintenta con código nuevo
        if (err.type === 'unavailable-id') {
          reject(new Error('Código de sala ya existe, intenta de nuevo'));
        } else if (err.type === 'peer-unavailable') {
          // ignorado, común al iniciar
        } else {
          reject(err);
        }
      });
    });
  },

  // Unirse a sala (cliente)
  async join(opts = {}) {
    await loadPeerJS();
    const code = (opts.code || '').toUpperCase().trim();
    if (!code) throw new Error('Código requerido');
    const hostId = ROOM_PREFIX + code;
    const peer = new Peer(undefined, {
      host: PEERJS_HOST, port: PEERJS_PORT, path: PEERJS_PATH,
      debug: 1,
    });
    const myName = opts.name || 'Cliente';
    const state = {
      role: 'client',
      code,
      hostId,
      myId: null,
      myName,
      carId: opts.carId ?? 0,
      color: opts.color ?? 0x4488ff,
      peer,
      hostConn: null,
      roster: [],
      handlers: {
        message: new Map(),
        peerJoin: new Set(),
        peerLeave: new Set(),
        roster: new Set(),
        ready: new Set(),
        error: new Set(),
      },
    };

    function emit(type, ...args) {
      const set = state.handlers[type];
      if (!set) return;
      set.forEach((fn) => { try { fn(...args); } catch (e) {} });
    }
    function on(type, fn) {
      if (!state.handlers[type]) state.handlers[type] = new Set();
      state.handlers[type].add(fn);
    }

    return new Promise((resolve, reject) => {
      peer.on('open', () => {
        state.myId = peer.id;
        const conn = peer.connect(hostId, { reliable: true });
        state.hostConn = conn;

        conn.on('open', () => {
          // Presentarse
          try {
            conn.send(JSON.stringify({
              type: 'hello',
              name: state.myName,
              carId: state.carId,
              color: state.color,
            }));
          } catch (e) {}
        });

        conn.on('data', (raw) => {
          let msg;
          try { msg = JSON.parse(raw); } catch (e) { return; }
          if (msg.type === 'identify') {
            // reenviar hello si no se identificó antes
            try {
              conn.send(JSON.stringify({
                type: 'hello',
                name: state.myName,
                carId: state.carId,
                color: state.color,
              }));
            } catch (e) {}
          } else if (msg.type === 'hello-back') {
            // recibimos roster + info del host
            state.roster = (msg.roster || []).slice();
            // agregar host si no está
            if (!state.roster.find(r => r.id === hostId)) {
              state.roster.unshift({
                id: hostId,
                name: msg.hostName,
                carId: msg.hostCarId,
                color: msg.hostColor,
                isHost: true,
              });
            }
            emit('roster', state.roster);
          } else if (msg.type === 'peer-join') {
            if (!state.roster.find(r => r.id === msg.id)) {
              state.roster.push({ id: msg.id, name: msg.name, carId: msg.carId, color: msg.color, isHost: false });
              emit('roster', state.roster);
              emit('peerJoin', { id: msg.id, name: msg.name, carId: msg.carId, color: msg.color });
            }
          } else if (msg.type === 'peer-leave') {
            state.roster = state.roster.filter(r => r.id !== msg.id);
            emit('roster', state.roster);
            emit('peerLeave', { id: msg.id });
          } else {
            emit('message', msg, msg.from || null);
          }
        });

        conn.on('close', () => {
          emit('peerLeave', { id: hostId, host: true });
          state.roster = state.roster.filter(r => r.id !== hostId);
          emit('roster', state.roster);
        });
        conn.on('error', (e) => {
          console.warn('Host conn error', e);
          if (e.type === 'peer-unavailable') {
            reject(new Error('Sala no encontrada. Verifica el código.'));
          }
        });

        const api = {
          id: peer.id,
          code,
          role: 'client',
          myName: state.myName,
          hostId,
          roster: state.roster,
          on,
          send(msg) { // el cliente solo manda al host
            if (state.hostConn && state.hostConn.open) {
              try { state.hostConn.send(JSON.stringify(msg)); } catch (e) {}
            }
          },
          sendTo() { /* noop en cliente */ },
          destroy() {
            try { if (state.hostConn) state.hostConn.close(); } catch (e) {}
            try { peer.destroy(); } catch (e) {}
          },
        };
        emit('ready', api);
        resolve(api);
      });

      peer.on('error', (err) => {
        console.error('Peer error:', err);
        emit('error', err);
        if (err.type === 'peer-unavailable') {
          reject(new Error('Sala no encontrada. Verifica el código.'));
        } else if (err.type === 'network') {
          reject(new Error('Sin conexión al servidor de PeerJS. Revisa tu red.'));
        } else if (err.type === 'server-error') {
          reject(new Error('Servidor de PeerJS no disponible. Intenta en un momento.'));
        } else if (err.type === 'ssl-unavailable') {
          reject(new Error('SSL requerido. PeerJS solo funciona sobre HTTPS.'));
        } else {
          reject(err);
        }
      });
    });
  },
};

window.MP = MP;
