// routes/api.js - API Routes
const express = require("express");
const router = express.Router();

// Get all sessions
router.get("/sessions", async (req, res) => {
  try {
    const sessions = await req.sessionManager.getAllSessions();
    res.json({ success: true, data: sessions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create new session
router.post("/sessions", async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: "Session ID is required" });
    }

    await req.sessionManager.createSession(sessionId);
    res.json({ success: true, message: "Session created, waiting for QR scan" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get session QR code
router.get("/sessions/:sessionId/qr", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const qrCode = await req.sessionManager.getQR(sessionId);

    if (!qrCode) {
      return res.status(404).json({ success: false, error: "QR code not available" });
    }

    res.json({ success: true, data: { qrCode } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/session/:sessionId/refresh", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const refreshSession = await req.sessionManager.createSession(sessionId, false);

    if (!refreshSession) {
      return res.status(404).json({ success: false, error: "Cannot refresh" });
    }

    res.json({ success: true, data: { refreshSession } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete session
router.delete("/sessions/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    await req.sessionManager.deleteSession(sessionId);
    res.json({ success: true, message: "Session deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Logout session
router.post("/sessions/:sessionId/logout", async (req, res) => {
  try {
    const { sessionId } = req.params;
    await req.sessionManager.logoutSession(sessionId);
    res.json({ success: true, message: "Session logged out successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Send message
router.post("/send-message/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({ success: false, error: "Recipient and message are required" });
    }

    const result = await req.sessionManager.sendMessage(sessionId, to, message);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload file
const multer = require("multer");
const path = require("path");
const fs = require("fs");
// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "../uploads");
    // Create the directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});

// Filter function to validate file types
const fileFilter = (req, file, cb) => {
  // Accept images, videos, documents, audio
  if (
    file.mimetype.startsWith("image/") ||
    file.mimetype.startsWith("video/") ||
    file.mimetype.startsWith("audio/") ||
    file.mimetype === "application/pdf" ||
    file.mimetype.includes("document")
  ) {
    cb(null, true);
  } else {
    cb(new Error("Unsupported file type"), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 16 * 1024 * 1024 }, // 16MB limit
});
// Send media
router.post("/send-media/:sessionId", upload.single("media"), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { to, caption } = req.body;

    if (!to) {
      return res.status(400).json({
        success: false,
        error: "Recipient is required",
      });
    }

    // Check if file was uploaded
    if (!req.file) {
      // Fall back to URL-based media if no file was uploaded
      const { mediaUrl, mediaType } = req.body;

      if (!mediaUrl || !mediaType) {
        return res.status(400).json({
          success: false,
          error: "Either a file upload or media URL with type is required",
        });
      }

      const result = await req.sessionManager.sendMedia(
        sessionId,
        to,
        caption || "",
        mediaUrl,
        mediaType
      );

      return res.json({ success: true, data: result });
    }

    // If file was uploaded, use the file path
    const mediaPath = req.file.path;
    const mediaType = req.file.mimetype.startsWith("image/")
      ? "image"
      : req.file.mimetype.startsWith("video/")
      ? "video"
      : req.file.mimetype.startsWith("audio/")
      ? "audio"
      : "document";

    // Use the file system path for sending media
    const result = await req.sessionManager.sendMedia(
      sessionId,
      to,
      caption || "",
      mediaPath,
      mediaType
    );

    res.json({ success: true, data: result });
  } catch (error) {
    // Clean up uploaded file if an error occurs
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get contacts
router.get("/contacts/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const contacts = await req.sessionManager.getContacts(sessionId);
    res.json({ success: true, data: contacts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Schedule Message
router.post("/schedule-message/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { to, message, scheduledTime, recurringOptions } = req.body;

    if (!to || !message || !scheduledTime) {
      return res
        .status(400)
        .json({ success: false, error: "Recipient, message, and scheduled time are required" });
    }

    const messageId = await req.sessionManager.scheduleMessage(
      sessionId,
      to,
      message,
      scheduledTime,
      recurringOptions
    );
    res.json({ success: true, data: { messageId } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Scheduled Messages
router.get("/schedule-messages/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const scheduledMessages = await req.sessionManager.getScheduledMessages(sessionId);
    res.json({ success: true, data: scheduledMessages });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Edit Scheduled Message
router.put("/schedule-message/:sessionId/:messageId", async (req, res) => {
  try {
    const { sessionId, messageId } = req.params;
    const { to, message, scheduledTime } = req.body;

    const updatedMessage = await req.sessionManager.editScheduledMessage(sessionId, messageId, {
      to,
      message,
      scheduledTime,
    });
    res.json({ success: true, data: updatedMessage });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete Scheduled Message
router.delete("/schedule-message/:sessionId/:messageId", async (req, res) => {
  try {
    const { sessionId, messageId } = req.params;
    await req.sessionManager.deleteScheduledMessage(sessionId, messageId);
    res.json({ success: true, message: "Scheduled message deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get message history for a session
router.get("/:sessionId/messages", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { status, type, recipient, startDate, endDate, page, limit, sortAsc } = req.query;

    const options = {
      status,
      type,
      recipient,
      startDate,
      endDate,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
      sortAsc: sortAsc === "true",
    };

    const messages = await req.sessionManager.getMessageHistory(sessionId, options);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get message detail by ID
router.get("/:sessionId/messages/:messageId", async (req, res) => {
  try {
    const { sessionId, messageId } = req.params;

    // Use the new function to get the message
    const message = await req.sessionManager.getMessageById(sessionId, messageId);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json(message);
  } catch (error) {
    console.error(`Error fetching message detail: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get message statistics
router.get("/:sessionId/messages/stats", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { timeRange } = req.query;

    const stats = await req.sessionManager.getMessageStats(sessionId, timeRange);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update message status manually
router.put("/:sessionId/messages/:messageId/status", async (req, res) => {
  try {
    const { sessionId, messageId } = req.params;
    const { status, additionalData } = req.body;

    const updatedMessage = await req.sessionManager.updateMessageStatus(
      sessionId,
      messageId,
      status,
      additionalData
    );

    res.json(updatedMessage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Request message status from WhatsApp
router.post("/:sessionId/messages/:messageId/request-status", async (req, res) => {
  try {
    const { sessionId, messageId } = req.params;
    const result = await req.sessionManager.requestMessageStatus(sessionId, messageId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete message history
router.delete("/:sessionId/messages", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { all, ids, before, status } = req.body;

    const result = await req.sessionManager.deleteMessageHistory(sessionId, {
      all,
      ids,
      before,
      status,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AI Routes

// Get AI configuration
router.get("/:sessionId/ai/config", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const config = await req.sessionManager.getAIConfig(sessionId);
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update AI configuration
router.put("/:sessionId/ai/config", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const configUpdates = req.body;

    const updatedConfig = await req.sessionManager.updateAIConfig(sessionId, configUpdates);
    res.json({ success: true, data: updatedConfig });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get conversation history
router.get("/:sessionId/ai/conversation/:contactId", async (req, res) => {
  try {
    const { sessionId, contactId } = req.params;
    const { limit } = req.query;

    const history = await req.sessionManager.getConversationHistory(
      sessionId,
      contactId,
      limit ? parseInt(limit) : undefined
    );

    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear conversation history
router.delete("/:sessionId/ai/conversation/:contactId", async (req, res) => {
  try {
    const { sessionId, contactId } = req.params;

    await req.sessionManager.clearConversationHistory(sessionId, contactId);
    res.json({ success: true, message: "Conversation history cleared" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test AI configuration
router.post("/:sessionId/ai/test", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, error: "Test message is required" });
    }

    const result = await req.sessionManager.testAIConfig(sessionId, message);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear AI response cache
router.post("/:sessionId/ai/cache/clear", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await req.sessionManager.clearCache(sessionId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get AI cache statistics
router.get("/:sessionId/ai/cache/stats", async (req, res) => {
  try {
    const stats = await req.sessionManager.getCacheStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Process message with AI
router.post("/:sessionId/ai/process", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { contactId, message } = req.body;

    if (!contactId || !message) {
      return res.status(400).json({
        success: false,
        error: "Contact ID and message are required",
      });
    }

    const result = await req.sessionManager.processMessageWithAI(sessionId, contactId, message);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
