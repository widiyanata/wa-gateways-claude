const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const bodyParser = require("body-parser");
const fs = require("fs-extra");
const path = require("path");
const { createSessionManager } = require("./utils/sessionManager");
const helpers = require("./utils/helpers");
const apiRoutes = require("./routes/api");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// View engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Buat folder sessions jika belum ada
const sessionsDir = path.join(__dirname, "sessions");
fs.ensureDirSync(sessionsDir);

// Initialize session manager
const sessionManager = createSessionManager(io);

// Share session manager dengan routes
app.use((req, res, next) => {
  req.sessionManager = sessionManager;
  next();
});

// Routes
app.get("/", (req, res) => {
  res.render("dashboard", {
    title: "WhatsApp Gateway Dashboard",
  });
});

app.get("/index", (req, res) => {
  res.render("index", {
    title: "Index WhatsApp Gateway Dashboard",
  });
});

app.get("/create-session", (req, res) => {
  res.render("create-session", {
    title: "Create New Session",
  });
});

app.get("/session/:id", (req, res) => {
  const sessionId = req.params.id;
  res.render("session-detail", {
    title: `Session: ${sessionId}`,
    sessionId,
  });
});

app.get("/session/:id/bulk-message", (req, res) => {
  const sessionId = req.params.id;
  res.render("bulk-message", {
    title: `Bulk Message: ${sessionId}`,
    sessionId,
  });
});

app.post("/session/:sessionId/bulk-message", async (req, res) => {
  try {
    const template = req.body.template; // Template pesan dari input user
    const { sessionId } = req.params;
    const dataJson = JSON.parse(req.body.datajson);

    let messages = [];
    dataJson.forEach(async (item) => {
      messages.push({
        to: item.no,
        message: helpers.renderTemplate(template, item),
        scheduledTime:
          helpers.formatDateToYYYYMMDD(item.tanggal) + " " + helpers.getRandomTime(8, 16),
      });
    });

    const result = await req.sessionManager.bulkScheduleMessages(sessionId, messages);
    console.log("bulkScheduleMessages", result);

    return res.json({ success: true, message: result });
  } catch (error) {
    console.error("Error in bulk message endpoint:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to schedule bulk messages",
      error: error.message,
    });
  }
});

app.get("/documentation", (req, res) => {
  res.render("documentation", {
    title: "API Documentation",
  });
});

app.get("/settings", (req, res) => {
  res.render("settings", {
    title: "Settings",
  });
});

// API routes
app.use("/api", apiRoutes);

// Socket.IO connection
io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Open your browser and go to http://localhost:${PORT}`);
});

// Menangani process exit
process.on("SIGINT", async () => {
  console.log("Closing application and disconnecting WhatsApp sessions...");
  // remove all sessions
  // await sessionManager.closeAllSessions();
  process.exit(0);
});
