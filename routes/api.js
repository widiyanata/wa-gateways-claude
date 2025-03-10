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

// Send media
router.post("/send-media/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { to, caption, mediaUrl, mediaType } = req.body;

    if (!to || !mediaUrl || !mediaType) {
      return res.status(400).json({
        success: false,
        error: "Recipient, media URL, and media type are required",
      });
    }

    const result = await req.sessionManager.sendMedia(
      sessionId,
      to,
      caption || "",
      mediaUrl,
      mediaType
    );

    res.json({ success: true, data: result });
  } catch (error) {
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

module.exports = router;
