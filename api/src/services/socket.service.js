let io;

function scheduleExpiryDisconnect(socket, expiresAt) {
  const expiresMs = new Date(expiresAt).getTime();
  const delay = expiresMs - Date.now();
  if (!Number.isFinite(delay) || delay <= 0) {
    socket.disconnect(true);
    return null;
  }
  const timer = setTimeout(() => socket.disconnect(true), delay);
  socket.once?.('disconnect', () => clearTimeout(timer));
  return timer;
}

function initializeSocket(server, options = {}) {
  const { Server } = require('socket.io');
  io = new Server(server, options);
  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.auth?.token || socket.handshake.headers?.authorization || '';
      const token = String(raw).replace(/^Bearer\s+/i, '');
      if (!token) throw new Error('Token Socket.IO obrigatorio');
      const authManager = require('../managers/auth.manager');
      socket.data.admin = await authManager.authenticateAccess(token);
      scheduleExpiryDisconnect(socket, socket.data.admin.accessTokenExpiresAt);
      next();
    } catch (error) {
      next(new Error('Nao autorizado: ' + error.message));
    }
  });
  io.on('connection', (socket) => {
    socket.emit('system:ready', { at: new Date().toISOString(), admin: socket.data.admin });
  });
  return io;
}

function emit(event, payload) {
  io?.emit(event, payload);
}

function getSocket() {
  return io;
}

module.exports = { initializeSocket, emit, getSocket, scheduleExpiryDisconnect };
