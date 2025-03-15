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

        // Set up message history tracking
        setupMessageStatusUpdates(sessionId, sock);
      }
    });

    // Save credentials on update
    sock.ev.on("creds.update", saveCreds);

    // Handle incoming messages
    sock.ev.on("messages.upsert", async (m) => {
      io.emit(`${sessionId}.message`, m);

      // Save incoming messages to history as well
      try {
        if (m.type === "notify" && Array.isArray(m.messages)) {
          for (const msg of m.messages) {
            // Only process messages that are from others (not sent by us)
            if (msg.key && !msg.key.fromMe) {
              const sender = msg.key.remoteJid;
              const messageContent = msg.message;
              let content = "";
              let mediaType = null;
              let mediaUrl = null;

              // Extract text content based on message type
              if (messageContent?.conversation) {
                content = messageContent.conversation;
              } else if (messageContent?.extendedTextMessage?.text) {
                content = messageContent.extendedTextMessage.text;
              } else if (messageContent?.imageMessage) {
                content = messageContent.imageMessage.caption || "";
                mediaType = "image";
              } else if (messageContent?.videoMessage) {
                content = messageContent.videoMessage.caption || "";
                mediaType = "video";
              } else if (messageContent?.documentMessage) {
                content = messageContent.documentMessage.fileName || "";
                mediaType = "document";
              } else if (messageContent?.audioMessage) {
                content = "Audio message";
                mediaType = "audio";
              } else if (messageContent?.stickerMessage) {
                content = "Sticker";
                mediaType = "sticker";
              }

              // Save incoming message to history
              const incomingMessage = {
                id: msg.key.id,
                sessionId,
                from: sender,
                message: content,
                type: mediaType ? "media" : "text",
                mediaType,
                mediaUrl,
                direction: "incoming",
                status: "received",
                timestamp: msg.messageTimestamp,
                rawMessage: msg, // Store the raw message for reference
              };

              await saveMessageToHistory(sessionId, incomingMessage);

              // Emit event for any listeners
              io.emit(`${sessionId}.message.received`, incomingMessage);
            }
          }
        }
      } catch (error) {
        console.error(`Error processing incoming message: ${error.message}`);
      }
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

      // Save to message history
      const messageData = {
        id: result.key.id,
        sessionId,
        to: formattedNumber,
        message,
        type: "text",
        status: "sent",
        timestamp: result.messageTimestamp,
        whatsappTimestamp: result.messageTimestamp,
      };

      await saveMessageToHistory(sessionId, messageData);

      return { id: result.key.id, timestamp: result.messageTimestamp };
    } catch (error) {
      // Save failed message to history
      const messageData = {
        id: generateUniqueId(),
        sessionId,
        to,
        message,
        type: "text",
        status: "failed",
        error: error.message,
      };

      await saveMessageToHistory(sessionId, messageData);

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

      // Save to message history
      const messageData = {
        id: result.key.id,
        sessionId,
        to: formattedNumber,
        caption,
        mediaUrl,
        mediaType,
        type: "media",
        status: "sent",
        timestamp: result.messageTimestamp,
        whatsappTimestamp: result.messageTimestamp,
      };

      await saveMessageToHistory(sessionId, messageData);

      return { id: result.key.id, timestamp: result.messageTimestamp };
    } catch (error) {
      // Save failed media message to history
      const messageData = {
        id: generateUniqueId(),
        sessionId,
        to,
        caption,
        mediaUrl,
        mediaType,
        type: "media",
        status: "failed",
        error: error.message,
      };

      await saveMessageToHistory(sessionId, messageData);

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

  // Refresh All Session
  const refreshAllSessions = async () => {
    console.log("Refreshing all sessions...");
    // get all sessions
    const sessionLists = await getAllSessions();
    console.log("sessionLists", sessionLists);

    for (const sessionList of sessionLists) {
      const { id } = sessionList;
      console.log("id", id);
      await createSession(id, false);
    }
  };

  // Schedule message
  const cron = require("node-cron");
  const { v4: uuidv4 } = require("uuid");

  const scheduledTasks = new Map();

  // Enhance scheduleMessage to support recurring schedules
  const scheduleMessage = async (
    sessionId,
    to,
    message,
    scheduledTime,
    recurringOptions = null,
    messageId = null
  ) => {
    if (messageId === null) {
      messageId = generateUniqueId();
    }

    let task;

    // If there are recurring options, set up a recurring schedule
    if (recurringOptions && recurringOptions.type) {
      // Validate recurring options
      if (!["daily", "weekly", "monthly", "custom"].includes(recurringOptions.type)) {
        throw new Error("Invalid recurring type. Must be 'daily', 'weekly', or 'custom'");
      }

      let cronExpression;
      const scheduledDate = new Date(scheduledTime);

      if (isNaN(scheduledDate)) {
        throw new Error("Invalid scheduled time");
      }

      // Generate cron expression based on recurring type
      switch (recurringOptions.type) {
        case "daily":
          // Run every day at the specified time
          cronExpression = `${scheduledDate.getMinutes()} ${scheduledDate.getHours()} * * *`;
          break;

        case "weekly":
          // Run every week on the same day at the specified time
          cronExpression = `${scheduledDate.getMinutes()} ${scheduledDate.getHours()} * * ${scheduledDate.getDay()}`;
          break;

        case "monthly":
          // Run every month on the same day at the specified time
          cronExpression = `${scheduledDate.getMinutes()} ${scheduledDate.getHours()} ${scheduledDate.getDate()} * *`;
          break;

        case "custom":
          // Custom days of the week (e.g., ['monday', 'wednesday', 'friday'])
          if (
            !recurringOptions.days ||
            !Array.isArray(recurringOptions.days) ||
            recurringOptions.days.length === 0
          ) {
            throw new Error("Custom recurring type requires 'days' array");
          }

          const dayMap = {
            sunday: 0,
            monday: 1,
            tuesday: 2,
            wednesday: 3,
            thursday: 4,
            friday: 5,
            saturday: 6,
          };

          const dayNumbers = recurringOptions.days.map((day) => {
            const dayNumber = dayMap[day.toLowerCase()];
            if (dayNumber === undefined) {
              throw new Error(`Invalid day: ${day}`);
            }
            return dayNumber;
          });

          cronExpression = `${scheduledDate.getMinutes()} ${scheduledDate.getHours()} * * ${dayNumbers.join(
            ","
          )}`;
          break;
      }

      console.log("Recurring cron expression:", cronExpression);

      task = cron.schedule(cronExpression, async () => {
        try {
          console.log(`Sending scheduled recurring message: ${messageId}`);
          await sendMessage(sessionId, to, message);

          // Update last sent time
          await updateScheduledMessage(sessionId, messageId, {
            lastSent: new Date().toISOString(),
            status: "active",
          });

          // If there's an end date and we've passed it, stop the task
          if (recurringOptions.endDate) {
            const endDate = new Date(recurringOptions.endDate);
            if (!isNaN(endDate) && new Date() > endDate) {
              task.stop();
              scheduledTasks.delete(messageId);
              await updateScheduledMessage(sessionId, messageId, { status: "completed" });
            }
          }
        } catch (error) {
          console.error(`Failed to send recurring message ${messageId}:`, error);
          await updateScheduledMessage(sessionId, messageId, {
            lastError: error.message,
            lastErrorTime: new Date().toISOString(),
          });
        }
      });

      scheduledTasks.set(messageId, task);

      // Save the scheduled message with recurring information
      await saveScheduledMessage(sessionId, {
        id: messageId,
        to,
        message,
        scheduledTime,
        recurringOptions,
        status: "active",
        type: "recurring",
      });
    } else {
      // Original one-time schedule logic
      const scheduledDate = new Date(scheduledTime);
      if (isNaN(scheduledDate)) {
        throw new Error("Invalid scheduled time");
      }

      const cronTime = `${scheduledDate.getMinutes()} ${scheduledDate.getHours()} ${scheduledDate.getDate()} ${
        scheduledDate.getMonth() + 1
      } *`;

      console.log("Cron time:", cronTime);

      task = cron.schedule(cronTime, async () => {
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

      if (messageId === null) {
        await saveScheduledMessage(sessionId, {
          id: messageId,
          to,
          message,
          scheduledTime,
          status: "scheduled",
          type: "one-time",
        });
      } else {
        await updateScheduledMessage(sessionId, messageId, {
          to,
          message,
          scheduledTime,
        });
      }
    }

    return messageId;
  };

  // Add a new function to cancel recurring messages
  const cancelRecurringMessage = async (sessionId, messageId) => {
    if (scheduledTasks.has(messageId)) {
      scheduledTasks.get(messageId).stop();
      scheduledTasks.delete(messageId);
    }

    await updateScheduledMessage(sessionId, messageId, { status: "cancelled" });
    return { success: true, message: "Recurring message cancelled" };
  };

  const getScheduledMessages = async (sessionId) => {
    return await readScheduledMessages(sessionId);
  };

  const editScheduledMessage = async (sessionId, messageId, updatedData) => {
    const message = await updateScheduledMessage(sessionId, messageId, updatedData);
    if (scheduledTasks.has(messageId)) {
      console.log("Stopping task:", messageId);
      scheduledTasks.get(messageId).stop();
      scheduledTasks.delete(messageId);
    }
    await scheduleMessage(
      sessionId,
      message.to,
      message.message,
      message.scheduledTime,
      null,
      messageId
    );
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
    // console.log("CRONJOB:", cron.getTasks());
    return data.messages;
  };

  const saveScheduledMessage = async (sessionId, message) => {
    const filePath = path.join(SESSIONS_DIR, sessionId, "scheduled-messages.json");
    let data = { messages: [] };
    if (await fs.pathExists(filePath)) {
      data = await fs.readJson(filePath);
    }
    data.messages.push(message);
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

  // Update the bulkScheduleMessages function to support recurring options
  const bulkScheduleMessages = async (sessionId, messages, delaySeconds = 0) => {
    // Validate input
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("Messages must be a non-empty array");
    }

    const results = [];
    const errors = [];

    // Calculate base time for delayed messages
    const baseTime = new Date();
    let messageIndex = 0;

    // Process each message in the array
    for (const msg of messages) {
      try {
        // Validate basic message structure
        if (!msg.to || !msg.message) {
          throw new Error("Each message must have 'to' and 'message' properties");
        }

        // Handle case where scheduledTime is not set
        let scheduledTime = msg.scheduledTime;
        if (!scheduledTime && delaySeconds > 0) {
          // Calculate scheduled time based on delay
          const delayedTime = new Date(baseTime.getTime() + delaySeconds * 1000 * messageIndex);
          scheduledTime = delayedTime.toISOString();
        } else if (!scheduledTime) {
          // If no delay specified and no scheduledTime, throw error
          throw new Error("Message must have 'scheduledTime' or a delay must be specified");
        }

        // Schedule the individual message, passing recurring options if present
        const messageId = await scheduleMessage(
          sessionId,
          msg.to,
          msg.message,
          scheduledTime,
          msg.recurringOptions || null
        );

        results.push({
          id: messageId,
          to: msg.to,
          message: msg.message,
          scheduledTime: scheduledTime,
          recurringOptions: msg.recurringOptions || null,
          status: msg.recurringOptions ? "active" : "scheduled",
          type: msg.recurringOptions ? "recurring" : "one-time",
        });
      } catch (error) {
        errors.push({
          to: msg.to,
          message: msg.message,
          scheduledTime: msg.scheduledTime,
          error: error.message,
        });
      }

      // Increment message index for delay calculations
      messageIndex++;
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

  // Store message history in a JSON file for each session
  const saveMessageToHistory = async (sessionId, messageData) => {
    try {
      const historyDir = path.join(SESSIONS_DIR, sessionId);
      const historyFile = path.join(historyDir, "message-history.json");

      // Create directory if it doesn't exist
      await fs.ensureDir(historyDir);

      // Read existing history or create new one
      let history = { messages: [] };
      if (await fs.pathExists(historyFile)) {
        history = await fs.readJson(historyFile);
      }

      // Add message to history with timestamp
      const timestamp = new Date().toISOString();
      messageData.timestamp = timestamp;
      messageData.createdAt = timestamp;

      history.messages.push(messageData);

      // Write updated history back to file
      await fs.writeJson(historyFile, history, { spaces: 2 });

      return messageData;
    } catch (error) {
      console.error(`Failed to save message history: ${error.message}`);
      // Don't throw error here to prevent interrupting the main flow
      return null;
    }
  };

  // Update message status in history
  const updateMessageStatus = async (sessionId, messageId, status, additionalData = {}) => {
    try {
      const historyFile = path.join(SESSIONS_DIR, sessionId, "message-history.json");

      if (!(await fs.pathExists(historyFile))) {
        throw new Error("Message history not found");
      }

      const history = await fs.readJson(historyFile);
      const messageIndex = history.messages.findIndex((msg) => msg.id === messageId);

      if (messageIndex === -1) {
        throw new Error(`Message with ID ${messageId} not found`);
      }

      // Update the message status and add status update timestamp
      history.messages[messageIndex] = {
        ...history.messages[messageIndex],
        status,
        statusUpdatedAt: new Date().toISOString(),
        ...additionalData,
      };

      await fs.writeJson(historyFile, history, { spaces: 2 });
      return history.messages[messageIndex];
    } catch (error) {
      console.error(`Failed to update message status: ${error.message}`);
      throw error;
    }
  };

  const getMessageHistory = async (sessionId, options = {}) => {
    try {
      const historyFile = path.join(SESSIONS_DIR, sessionId, "message-history.json");

      if (!(await fs.pathExists(historyFile))) {
        return { messages: [] };
      }

      const history = await fs.readJson(historyFile);
      let messages = [...history.messages];

      // Apply filters if specified
      if (options.status) {
        messages = messages.filter((msg) => msg.status === options.status);
      }

      if (options.type) {
        messages = messages.filter((msg) => msg.type === options.type);
      }

      if (options.recipient) {
        messages = messages.filter((msg) => msg.to.includes(options.recipient));
      }

      // Apply date range filter if specified
      if (options.startDate) {
        const startDate = new Date(options.startDate);
        messages = messages.filter((msg) => new Date(msg.timestamp) >= startDate);
      }

      if (options.endDate) {
        const endDate = new Date(options.endDate);
        messages = messages.filter((msg) => new Date(msg.timestamp) <= endDate);
      }

      // Apply pagination
      const page = options.page || 1;
      const limit = options.limit || 50;
      const startIndex = (page - 1) * limit;
      const endIndex = page * limit;

      // Sort messages by timestamp (newest first by default)
      messages.sort((a, b) => {
        const timeA = new Date(a.timestamp);
        const timeB = new Date(b.timestamp);
        return options.sortAsc ? timeA - timeB : timeB - timeA;
      });

      const paginatedMessages = messages.slice(startIndex, endIndex);

      return {
        messages: paginatedMessages,
        pagination: {
          total: messages.length,
          page,
          limit,
          pages: Math.ceil(messages.length / limit),
        },
      };
    } catch (error) {
      throw new Error(`Failed to retrieve message history: ${error.message}`);
    }
  };

  const getMessageById = async (sessionId, messageId) => {
    try {
      const historyFile = path.join(SESSIONS_DIR, sessionId, "message-history.json");

      // Check if history file exists
      if (!(await fs.pathExists(historyFile))) {
        return null;
      }

      // Read the history file
      const history = await fs.readJson(historyFile);

      // Find the specific message by ID
      const message = history.messages.find((msg) => msg.id === messageId);

      // Return null if message not found
      if (!message) {
        return null;
      }

      // If message has media, prepare the media URL
      if (message.type === "media" && message.mediaPath) {
        // Construct the URL to access media files
        // Adjust the path structure based on how your app serves media files
        message.mediaUrl = `/api/${sessionId}/media/${message.mediaPath}`;
      }

      return message;
    } catch (error) {
      throw new Error(`Failed to retrieve message: ${error.message}`);
    }
  };

  // Add a message receipt handler to update delivery status
  const setupMessageStatusUpdates = (sessionId, sock) => {
    // Listen for message status updates
    sock.ev.on("messages.update", async (updates) => {
      console.log(`[${sessionId}] Message status updates:`, updates);

      for (const update of updates) {
        if (update.key && update.key.id && update.update) {
          const messageId = update.key.id;

          try {
            // Extract relevant status information
            const statusData = {
              ...update.update,
            };

            let status = "unknown";

            // Determine message status based on available flags
            if (statusData.status) {
              status = statusData.status; // 'sent', 'delivered', 'read'
            } else if (statusData.deliveredAt) {
              status = "delivered";
            } else if (statusData.readAt) {
              status = "read";
            }

            // Update message status in our records
            await updateMessageStatus(sessionId, messageId, status, statusData);

            // Emit event for frontend
            io.emit(`${sessionId}.message.status`, {
              messageId,
              status,
              ...statusData,
            });
          } catch (error) {
            console.error(`Error updating message status for ${messageId}:`, error);
          }
        }
      }
    });
  };

  // Add message receipt acknowledgment
  const requestMessageStatus = async (sessionId, messageId) => {
    try {
      const sock = getSession(sessionId);
      await sock.readMessages([{ id: messageId, remoteJid: null }]);
      return { success: true, message: "Status request sent" };
    } catch (error) {
      throw new Error(`Failed to request message status: ${error.message}`);
    }
  };

  // Add bulk delete for message history
  const deleteMessageHistory = async (sessionId, options = {}) => {
    try {
      const historyFile = path.join(SESSIONS_DIR, sessionId, "message-history.json");

      if (!(await fs.pathExists(historyFile))) {
        return { deleted: 0 };
      }

      const history = await fs.readJson(historyFile);
      const originalCount = history.messages.length;

      if (options.all === true) {
        // Delete all message history
        history.messages = [];
      } else if (options.ids && Array.isArray(options.ids)) {
        // Delete specific messages by ID
        history.messages = history.messages.filter((msg) => !options.ids.includes(msg.id));
      } else if (options.before) {
        // Delete messages before a certain date
        const beforeDate = new Date(options.before);
        history.messages = history.messages.filter((msg) => new Date(msg.timestamp) >= beforeDate);
      } else if (options.status) {
        // Delete messages with specific status
        history.messages = history.messages.filter((msg) => msg.status !== options.status);
      }

      // Write updated history back to file
      await fs.writeJson(historyFile, history, { spaces: 2 });

      return {
        deleted: originalCount - history.messages.length,
        remaining: history.messages.length,
      };
    } catch (error) {
      throw new Error(`Failed to delete message history: ${error.message}`);
    }
  };

  // Generate message statistics
  const getMessageStats = async (sessionId, timeRange = "all") => {
    try {
      const historyFile = path.join(SESSIONS_DIR, sessionId, "message-history.json");

      if (!(await fs.pathExists(historyFile))) {
        return {
          total: 0,
          statuses: {},
          types: {},
          timeline: [],
        };
      }

      const history = await fs.readJson(historyFile);
      let messages = [...history.messages];

      // Apply time range filter
      const now = new Date();
      if (timeRange === "today") {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        messages = messages.filter((msg) => new Date(msg.timestamp) >= today);
      } else if (timeRange === "week") {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        messages = messages.filter((msg) => new Date(msg.timestamp) >= weekAgo);
      } else if (timeRange === "month") {
        const monthAgo = new Date(now);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        messages = messages.filter((msg) => new Date(msg.timestamp) >= monthAgo);
      }

      // Calculate statistics
      const stats = {
        total: messages.length,
        statuses: {},
        types: {},
        recipients: {},
        timeline: [],
      };

      // Count by status and type
      messages.forEach((msg) => {
        // Count by status
        stats.statuses[msg.status] = (stats.statuses[msg.status] || 0) + 1;

        // Count by type
        stats.types[msg.type] = (stats.types[msg.type] || 0) + 1;

        // Count by recipient (only store first 20 for privacy)
        if (Object.keys(stats.recipients).length < 20) {
          stats.recipients[msg.to] = (stats.recipients[msg.to] || 0) + 1;
        }
      });

      // Generate timeline data (messages per day)
      const timelineMap = {};

      messages.forEach((msg) => {
        const date = new Date(msg.timestamp);
        const dateStr = `${date.getFullYear()}-${(date.getMonth() + 1)
          .toString()
          .padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;

        timelineMap[dateStr] = (timelineMap[dateStr] || 0) + 1;
      });

      // Convert timeline to array and sort by date
      stats.timeline = Object.entries(timelineMap)
        .map(([date, count]) => ({
          date,
          count,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return stats;
    } catch (error) {
      throw new Error(`Failed to generate message statistics: ${error.message}`);
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
    scheduleMessage,
    getScheduledMessages,
    editScheduledMessage,
    deleteScheduledMessage,
    bulkScheduleMessages,
    bulkEditScheduledMessages,
    bulkDeleteScheduledMessages,
    refreshAllSessions,
    // message history
    getMessageHistory,
    updateMessageStatus,
    setupMessageStatusUpdates,
    requestMessageStatus,
    deleteMessageHistory,
    getMessageStats,
    getMessageById,
  };
};
