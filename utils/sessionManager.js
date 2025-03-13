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
      console.log("Connection update:", update);

      if (qr) {
        // Generate QR code as data URL
        const qrDataURL = await QRCode.toDataURL(qr);
        qrCodes.set(sessionId, qrDataURL);

        // Send QR to frontend
        io.emit(`qr.${sessionId}`, {
          sessionId,
          qrCode: qrDataURL,
        });
        // Send status to frontend
        io.emit(`session.${sessionId}.status`, {
          message: "Re-scan QR code",
        });
      }

      if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

        console.log("Disconnect reason:", lastDisconnect?.error?.output?.statusCode);

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

  // Schedule message
  const cron = require("node-cron");
  const { v4: uuidv4 } = require("uuid");

  const scheduledTasks = new Map();

  const scheduleMessage = async (sessionId, to, message, scheduledTime) => {
    const messageId = generateUniqueId();
    console.log("messageId", messageId);
    const scheduledDate = new Date(scheduledTime);
    if (isNaN(scheduledDate)) {
      throw new Error("Invalid scheduled time");
    }

    const cronTime = `${scheduledDate.getMinutes()} ${scheduledDate.getHours()} ${scheduledDate.getDate()} ${
      scheduledDate.getMonth() + 1
    } *`;

    console.log("Cron time:", cronTime);

    const task = cron.schedule(cronTime, async () => {
      try {
        console.log("Sending scheduled message:", messageId);
        await sendMessage(sessionId, to, message);
        // Update message status in storage
        await updateScheduledMessage(sessionId, messageId, { status: "sent" });
      } catch (error) {
        console.error(`Failed to send scheduled message ${messageId}:`, error);
        // Update message status to failed
        await updateScheduledMessage(sessionId, messageId, {
          status: "failed",
          error: error.message,
        });
      } finally {
        task.stop();
        scheduledTasks.delete(messageId);
        // Remove message from storage after sent or failed
        await removeScheduledMessage(sessionId, messageId);
      }
    });

    scheduledTasks.set(messageId, task);
    await saveScheduledMessage(sessionId, {
      id: messageId,
      to,
      message,
      scheduledTime,
      status: "scheduled",
    });

    return messageId;
  };

  const getScheduledMessages = async (sessionId) => {
    return await readScheduledMessages(sessionId);
  };

  const editScheduledMessage = async (sessionId, messageId, updatedData) => {
    const message = await updateScheduledMessage(sessionId, messageId, updatedData);
    if (scheduledTasks.has(messageId)) {
      scheduledTasks.get(messageId).stop();
      scheduledTasks.delete(messageId);
    }
    await scheduleMessage(sessionId, message.to, message.message, message.scheduledTime);
    return message;
  };

  const deleteScheduledMessage = async (sessionId, messageId) => {
    if (scheduledTasks.has(messageId)) {
      scheduledTasks.get(messageId).stop();
      scheduledTasks.delete(messageId);
    }
    await removeScheduledMessage(sessionId, messageId);
    return;
  };

  const generateUniqueId = () => {
    return uuidv4();
  };

  const readScheduledMessages = async (sessionId) => {
    const filePath = path.join(SESSIONS_DIR, sessionId, "scheduled-messages.json");
    if (!(await fs.pathExists(filePath))) {
      return [];
    }
    const data = await fs.readJson(filePath);
    return data.messages;
  };

  const saveScheduledMessage = async (sessionId, message) => {
    const filePath = path.join(SESSIONS_DIR, sessionId, "scheduled-messages.json");
    let data = { messages: [] };
    if (await fs.pathExists(filePath)) {
      data = await fs.readJson(filePath);
    }
    console.log("data awal: ", data);
    data.messages.push(message);
    console.log("data akhir: ", data);
    await fs.writeJson(filePath, data, { spaces: 2 });
  };

  const updateScheduledMessage = async (sessionId, messageId, updatedData) => {
    const filePath = path.join(SESSIONS_DIR, sessionId, "scheduled-messages.json");
    if (!(await fs.pathExists(filePath))) {
      throw new Error("No scheduled messages found");
    }
    const data = await fs.readJson(filePath);
    const messageIndex = data.messages.findIndex((msg) => msg.id === messageId);
    if (messageIndex === -1) {
      throw new Error("Scheduled message not found");
    }
    data.messages[messageIndex] = { ...data.messages[messageIndex], ...updatedData };
    await fs.writeJson(filePath, data, { spaces: 2 });
    return data.messages[messageIndex];
  };

  const removeScheduledMessage = async (sessionId, messageId) => {
    const filePath = path.join(SESSIONS_DIR, sessionId, "scheduled-messages.json");
    if (!(await fs.pathExists(filePath))) {
      throw new Error("No scheduled messages found");
    }
    const data = await fs.readJson(filePath);
    data.messages = data.messages.filter((msg) => msg.id !== messageId);
    await fs.writeJson(filePath, data, { spaces: 2 });
    return;
  };

  // Bulk schedule message
  // Add this function to your existing code
  const bulkScheduleMessages = async (sessionId, messages) => {
    // Validate input
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("Messages must be a non-empty array");
    }

    const results = [];
    const errors = [];

    // Process each message in the array
    for (const msg of messages) {
      try {
        // Validate each message object
        if (!msg.to || !msg.message || !msg.scheduledTime) {
          throw new Error("Each message must have 'to', 'message', and 'scheduledTime' properties");
        }

        // Schedule the individual message
        const messageId = await scheduleMessage(sessionId, msg.to, msg.message, msg.scheduledTime);

        results.push({
          id: messageId,
          to: msg.to,
          message: msg.message,
          scheduledTime: msg.scheduledTime,
          status: "scheduled",
        });
      } catch (error) {
        errors.push({
          to: msg.to,
          message: msg.message,
          scheduledTime: msg.scheduledTime,
          error: error.message,
        });
      }
    }

    return {
      success: results.length,
      failed: errors.length,
      successDetails: results,
      failureDetails: errors,
    };
  };

  // Add this function to batch edit scheduled messages
  const bulkEditScheduledMessages = async (sessionId, updates) => {
    if (!Array.isArray(updates) || updates.length === 0) {
      throw new Error("Updates must be a non-empty array");
    }

    const results = [];
    const errors = [];

    for (const update of updates) {
      try {
        if (!update.messageId) {
          throw new Error("Each update must have a 'messageId' property");
        }

        const updatedMessage = await editScheduledMessage(sessionId, update.messageId, {
          to: update.to,
          message: update.message,
          scheduledTime: update.scheduledTime,
        });

        results.push({
          id: update.messageId,
          status: "updated",
          details: updatedMessage,
        });
      } catch (error) {
        errors.push({
          messageId: update.messageId,
          error: error.message,
        });
      }
    }

    return {
      success: results.length,
      failed: errors.length,
      successDetails: results,
      failureDetails: errors,
    };
  };

  // Add this function to batch delete scheduled messages
  const bulkDeleteScheduledMessages = async (sessionId, messageIds) => {
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      throw new Error("MessageIds must be a non-empty array");
    }

    const results = [];
    const errors = [];

    for (const messageId of messageIds) {
      try {
        await deleteScheduledMessage(sessionId, messageId);
        results.push({
          id: messageId,
          status: "deleted",
        });
      } catch (error) {
        errors.push({
          id: messageId,
          error: error.message,
        });
      }
    }

    return {
      success: results.length,
      failed: errors.length,
      successDetails: results,
      failureDetails: errors,
    };
  };

  // Helper function to validate a batch of messages
  const validateBulkMessages = (messages) => {
    if (!Array.isArray(messages)) {
      return { valid: false, error: "Input must be an array" };
    }

    if (messages.length === 0) {
      return { valid: false, error: "Array cannot be empty" };
    }

    const invalidMessages = messages.filter((msg) => !msg.to || !msg.message || !msg.scheduledTime);

    if (invalidMessages.length > 0) {
      return {
        valid: false,
        error: "Some messages are missing required fields",
        invalidCount: invalidMessages.length,
      };
    }

    return { valid: true };
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
    scheduleMessage,
    getScheduledMessages,
    editScheduledMessage,
    deleteScheduledMessage,
    bulkScheduleMessages,
    bulkEditScheduledMessages,
    bulkDeleteScheduledMessages,
  };
};
