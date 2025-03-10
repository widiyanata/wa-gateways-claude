const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const fs = require("fs-extra");
const path = require("path");
const QRCode = require("qrcode");
const pino = require("pino");

const logger = pino({ level: "silent" });
const SESSIONS_DIR = path.join(process.cwd(), "sessions");

exports.createSessionManager = (io) => {
  const sessions = new Map();
  const qrCodes = new Map();

  const createSession = async (sessionId, newSession = true) => {
    // Validasi nama sesi
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
      throw new Error(
        "Invalid session ID. Use alphanumeric characters, underscore, or hyphen only"
      );
    }

    console.log("Session:", sessions);
    console.log("Session ID:", sessionId);

    if (newSession && sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }

    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    await fs.ensureDir(sessionDir);

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger,
    });

    // Handle connection events
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // Generate QR code as data URL
        const qrDataURL = await QRCode.toDataURL(qr);
        qrCodes.set(sessionId, qrDataURL);

        // Send QR to frontend
        io.emit(`qr.${sessionId}`, {
          sessionId,
          qrCode: qrDataURL,
        });
      }

      if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect) {
          // Reconnect if not logged out
          await createSession(sessionId, (newSession = false));
        } else {
          // Remove session if logged out
          sessions.delete(sessionId);
          io.emit("session.update", {
            action: "remove",
            sessionId,
          });
        }
      } else if (connection === "open") {
        // Session connected
        qrCodes.delete(sessionId);
        io.emit(`session.${sessionId}.connected`, {
          connected: true,
          user: sock.user,
        });

        io.emit("session.update", {
          action: "update",
          session: {
            id: sessionId,
            user: sock.user,
            connected: true,
          },
        });
      }
    });

    // Save credentials on update
    sock.ev.on("creds.update", saveCreds);

    // Handle incoming messages
    sock.ev.on("messages.upsert", (m) => {
      io.emit(`${sessionId}.message`, m);
    });

    sessions.set(sessionId, { sock, active: true });

    return { success: true, message: "Session created, waiting for QR scan" };
  };

  const getSession = (sessionId) => {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (!session.active) throw new Error(`Session ${sessionId} is not active`);
    return session.sock;
  };

  const getAllSessions = async () => {
    const sessionsList = [];

    // Get sessions from disk
    const dirs = await fs.readdir(SESSIONS_DIR);

    for (const dir of dirs) {
      const sessionDir = path.join(SESSIONS_DIR, dir);
      const stat = await fs.stat(sessionDir);

      if (stat.isDirectory()) {
        const session = sessions.get(dir);
        sessionsList.push({
          id: dir,
          connected: session ? true : false,
          user: session?.sock?.user || null,
        });
      }
    }

    return sessionsList;
  };

  const getQR = (sessionId) => {
    return qrCodes.get(sessionId);
  };

  const deleteSession = async (sessionId) => {
    try {
      const session = sessions.get(sessionId);
      if (session) {
        await logoutSession(sessionId);
        sessions.delete(sessionId);
      }

      const sessionDir = path.join(SESSIONS_DIR, sessionId);
      await fs.remove(sessionDir);

      io.emit("session.update", {
        action: "remove",
        sessionId,
      });

      return { success: true, message: "Session deleted successfully" };
    } catch (error) {
      throw new Error(`Failed to delete session: ${error.message}`);
    }
  };

  const logoutSession = async (sessionId) => {
    try {
      const session = sessions.get(sessionId);
      if (session) {
        await session.sock.logout();
        session.active = false;
      }

      return { success: true, message: "Session logged out successfully" };
    } catch (error) {
      throw new Error(`Failed to logout: ${error.message}`);
    }
  };

  const sendMessage = async (sessionId, to, message) => {
    try {
      const sock = getSession(sessionId);

      // Format nomor telepon
      const formattedNumber = to.includes("@") ? to : `${to.replace(/[^\d]/g, "")}@s.whatsapp.net`;

      const result = await sock.sendMessage(formattedNumber, { text: message });

      return { id: result.key.id, timestamp: result.messageTimestamp };
    } catch (error) {
      throw new Error(`Failed to send message: ${error.message}`);
    }
  };

  const sendMedia = async (sessionId, to, caption, mediaUrl, mediaType) => {
    try {
      const sock = getSession(sessionId);

      // Format nomor telepon
      const formattedNumber = to.includes("@") ? to : `${to.replace(/[^\d]/g, "")}@s.whatsapp.net`;

      let message = {};

      if (mediaType === "image") {
        message = {
          image: { url: mediaUrl },
          caption: caption,
        };
      } else if (mediaType === "video") {
        message = {
          video: { url: mediaUrl },
          caption: caption,
        };
      } else if (mediaType === "document") {
        message = {
          document: { url: mediaUrl },
          mimetype: "application/pdf",
          fileName: caption || "document.pdf",
        };
      } else {
        throw new Error("Unsupported media type");
      }

      const result = await sock.sendMessage(formattedNumber, message);

      return { id: result.key.id, timestamp: result.messageTimestamp };
    } catch (error) {
      throw new Error(`Failed to send media: ${error.message}`);
    }
  };

  const getContacts = async (sessionId) => {
    try {
      const sock = getSession(sessionId);
      const contacts = await sock.getContacts();
      return contacts;
    } catch (error) {
      throw new Error(`Failed to get contacts: ${error.message}`);
    }
  };

  const closeAllSessions = async () => {
    for (const [sessionId, session] of sessions.entries()) {
      try {
        await session.sock.logout();
      } catch (error) {
        console.error(`Error closing session ${sessionId}:`, error);
      }
    }
  };

  return {
    createSession,
    getSession,
    getAllSessions,
    getQR,
    deleteSession,
    logoutSession,
    sendMessage,
    sendMedia,
    getContacts,
    closeAllSessions,
  };
};
