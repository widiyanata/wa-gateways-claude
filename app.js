const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const bodyParser = require("body-parser");
const fs = require("fs-extra");
const path = require("path");
const { createSessionManager } = require("./utils/sessionManager");
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

    function getRandomTime(
      minHour = 0,
      maxHour = 23,
      minMinute = 0,
      maxMinute = 59,
      minSecond = 0,
      maxSecond = 59
    ) {
      // Validate input ranges
      minHour = Math.max(0, Math.min(23, minHour));
      maxHour = Math.max(0, Math.min(23, maxHour));
      minMinute = Math.max(0, Math.min(59, minMinute));
      maxMinute = Math.max(0, Math.min(59, maxMinute));
      minSecond = Math.max(0, Math.min(59, minSecond));
      maxSecond = Math.max(0, Math.min(59, maxSecond));

      // Ensure min is not greater than max
      if (minHour > maxHour) [minHour, maxHour] = [maxHour, minHour];
      if (minMinute > maxMinute) [minMinute, maxMinute] = [maxMinute, minMinute];
      if (minSecond > maxSecond) [minSecond, maxSecond] = [maxSecond, minSecond];

      // Generate random components within the specified ranges
      const hours = String(Math.floor(minHour + Math.random() * (maxHour - minHour + 1))).padStart(
        2,
        "0"
      );
      const minutes = String(
        Math.floor(minMinute + Math.random() * (maxMinute - minMinute + 1))
      ).padStart(2, "0");
      const seconds = String(
        Math.floor(minSecond + Math.random() * (maxSecond - minSecond + 1))
      ).padStart(2, "0");

      return `${hours}:${minutes}:${seconds}`;
    }
    function renderTemplate(template, data) {
      // Enhanced template rendering with error checking
      return template.replace(/{{\s*(\w+)\s*}}/g, (match, key) => {
        return data[key] !== undefined ? data[key] : match;
      });
    }
    function formatDateToYYYYMMDD(dateString) {
      const [day, month, year] = dateString.split("-");
      return `${year}-${month}-${day}`;
    }

    let messages = [];
    dataJson.forEach(async (item) => {
      messages.push({
        to: item.no,
        message: renderTemplate(template, item),
        scheduledTime: formatDateToYYYYMMDD(item.tanggal) + " " + getRandomTime(8, 17),
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
