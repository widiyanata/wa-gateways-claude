# WhatsApp Gateway Technical Context

## Technology Stack

### Backend
- **Node.js**: JavaScript runtime for server-side code
- **Express.js**: Web application framework for handling HTTP requests
- **Socket.IO**: Library for real-time, bidirectional communication
- **@whiskeysockets/baileys**: Library for WhatsApp Web API integration
- **node-cron**: Task scheduler for scheduling messages
- **EJS**: Templating engine for server-side rendering
- **fs-extra**: Enhanced file system methods

### Frontend
- **HTML/CSS/JavaScript**: Core web technologies
- **Socket.IO Client**: For real-time updates from the server
- **Bootstrap** (implied): For responsive UI components

### Development Tools
- **pkg**: Tool for packaging Node.js applications into executables
- **nodemon** (implied): For automatic server restarts during development

## Dependencies

### Core Dependencies
```json
{
  "@whiskeysockets/baileys": "^6.5.0",
  "body-parser": "^1.20.2",
  "ejs": "^3.1.9",
  "express": "^4.18.2",
  "fs-extra": "^11.1.1",
  "multer": "^1.4.5-lts.1",
  "node-cron": "^3.0.3",
  "pino": "^8.16.0",
  "qrcode": "^1.5.3",
  "socket.io": "^4.7.2",
  "uuid": "^11.1.0"
}
```

### Development Dependencies
```json
{
  "pkg": "^5.8.1"
}
```

## Project Structure

```
wa-gateways/
├── app.js                 # Main application entry point
├── package.json           # Project metadata and dependencies
├── routes/                # API and route handlers
│   └── api.js             # API endpoints
├── sessions/              # WhatsApp session data (created at runtime)
├── uploads/               # Media uploads directory
├── utils/                 # Utility functions
│   ├── helpers.js         # Helper functions
│   └── sessionManager.js  # WhatsApp session management
├── views/                 # EJS templates
│   ├── bulk-message.ejs   # Bulk messaging interface
│   ├── create-session.ejs # Session creation page
│   ├── dashboard.ejs      # Main dashboard
│   ├── documentation.ejs  # API documentation
│   ├── index.ejs          # Landing page
│   └── session-detail.ejs # Session details page
└── workers/               # Background workers (if any)
```

## Development Setup

### Prerequisites
- Node.js (v16 or higher recommended)
- npm or yarn package manager
- Basic understanding of JavaScript and Express.js

### Installation Steps
1. Clone the repository
2. Run `npm install` to install dependencies
3. Start the server with `npm start`
4. Access the application at `http://localhost:3000`

### Building for Production
The project includes configuration for packaging into a standalone executable:
```json
"pkg": {
  "assets": [
    "public/**/*",
    "views/**/*"
  ],
  "targets": [
    "node16-win-x64"
  ],
  "outputPath": "dist"
}
```

To build the executable:
```
npm run build
```

This creates a Windows executable in the `dist` directory.

## Technical Constraints

### WhatsApp API Limitations
- **Unofficial API**: The Baileys library uses an unofficial WhatsApp Web API, which may change without notice.
- **Authentication**: Requires QR code scanning for each session.
- **Rate Limiting**: WhatsApp may impose rate limits on message sending.
- **Media Handling**: Limited by WhatsApp's media size and type restrictions.

### Scalability Considerations
- **In-Memory Scheduling**: Scheduled messages are stored in memory, which doesn't scale across multiple instances.
- **File-Based Storage**: Session data is stored in the file system, which may become a bottleneck with many sessions.
- **Single Server Architecture**: The current design assumes a single server deployment.

### Security Considerations
- **Session Data**: Contains sensitive WhatsApp authentication credentials.
- **Message Content**: The application has access to all message content.
- **API Access Control**: No built-in authentication for API access.

## Future Technical Considerations

### For AI Integration
- **AI Model Selection**: Need to select an appropriate AI model or service.
- **Context Management**: Implementing efficient storage and retrieval of conversation context.
- **API Integration**: Connecting to external AI services securely.

### For Scaling
- **Database Migration**: Moving from file-based storage to a database for better scalability.
- **Distributed Scheduling**: Implementing a distributed task scheduler for message scheduling.
- **Load Balancing**: Supporting multiple application instances behind a load balancer.
