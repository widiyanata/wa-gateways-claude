const fs = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// Constants
const SESSIONS_DIR = path.join(process.cwd(), "sessions");
const DEFAULT_CONTEXT_LIMIT = 10; // Number of messages to keep in context
const DEFAULT_MAX_TOKENS = 150; // Default max tokens for AI response

/**
 * Creates an AI Manager for handling AI-powered responses
 * @param {Object} io - Socket.io instance for real-time updates
 * @returns {Object} AI Manager methods
 */
exports.createAIManager = (io) => {
  /**
   * Initialize AI configuration for a session
   * @param {string} sessionId - The session ID
   * @returns {Promise<Object>} The initialized AI configuration
   */
  const initializeAIConfig = async (sessionId) => {
    const configPath = path.join(SESSIONS_DIR, sessionId, "ai-config.json");

    // Check if config already exists
    if (await fs.pathExists(configPath)) {
      return await fs.readJson(configPath);
    }

    // Create default configuration
    const defaultConfig = {
      enabled: false,
      instructions:
        "You are a helpful assistant. Respond to messages in a friendly and concise manner.",
      model: "gpt-3.5-turbo",
      maxTokens: DEFAULT_MAX_TOKENS,
      temperature: 0.7,
      contextLimit: DEFAULT_CONTEXT_LIMIT,
      autoReply: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Create directory if it doesn't exist
    await fs.ensureDir(path.join(SESSIONS_DIR, sessionId));

    // Save default configuration
    await fs.writeJson(configPath, defaultConfig, { spaces: 2 });

    return defaultConfig;
  };

  /**
   * Get AI configuration for a session
   * @param {string} sessionId - The session ID
   * @returns {Promise<Object>} The AI configuration
   */
  const getAIConfig = async (sessionId) => {
    try {
      const configPath = path.join(SESSIONS_DIR, sessionId, "ai-config.json");

      // Initialize if not exists
      if (!(await fs.pathExists(configPath))) {
        return await initializeAIConfig(sessionId);
      }

      return await fs.readJson(configPath);
    } catch (error) {
      console.error(`Failed to get AI config: ${error.message}`);
      throw new Error(`Failed to get AI configuration: ${error.message}`);
    }
  };

  /**
   * Update AI configuration for a session
   * @param {string} sessionId - The session ID
   * @param {Object} configUpdates - The configuration updates
   * @returns {Promise<Object>} The updated AI configuration
   */
  const updateAIConfig = async (sessionId, configUpdates) => {
    try {
      // Get current config
      const currentConfig = await getAIConfig(sessionId);

      // Update config
      const updatedConfig = {
        ...currentConfig,
        ...configUpdates,
        updatedAt: new Date().toISOString(),
      };

      // Save updated config
      const configPath = path.join(SESSIONS_DIR, sessionId, "ai-config.json");
      await fs.writeJson(configPath, updatedConfig, { spaces: 2 });

      // Emit event for real-time updates
      io.emit(`${sessionId}.ai.config.updated`, {
        sessionId,
        config: updatedConfig,
      });

      return updatedConfig;
    } catch (error) {
      console.error(`Failed to update AI config: ${error.message}`);
      throw new Error(`Failed to update AI configuration: ${error.message}`);
    }
  };

  /**
   * Get conversation history for a session
   * @param {string} sessionId - The session ID
   * @param {string} contactId - The contact ID (phone number)
   * @param {number} limit - Maximum number of messages to retrieve
   * @returns {Promise<Array>} The conversation history
   */
  const getConversationHistory = async (sessionId, contactId, limit = DEFAULT_CONTEXT_LIMIT) => {
    try {
      const historyPath = path.join(SESSIONS_DIR, sessionId, "conversation-history.json");

      // Create empty history if it doesn't exist
      if (!(await fs.pathExists(historyPath))) {
        await fs.writeJson(historyPath, { conversations: {} }, { spaces: 2 });
        return [];
      }

      const history = await fs.readJson(historyPath);

      // Get conversation for this contact
      const conversation = history.conversations[contactId] || [];

      // Return the most recent messages up to the limit
      return conversation.slice(-limit);
    } catch (error) {
      console.error(`Failed to get conversation history: ${error.message}`);
      return []; // Return empty array on error to avoid breaking the flow
    }
  };

  /**
   * Add a message to the conversation history
   * @param {string} sessionId - The session ID
   * @param {string} contactId - The contact ID (phone number)
   * @param {Object} message - The message to add
   * @returns {Promise<Array>} The updated conversation history
   */
  const addToConversationHistory = async (sessionId, contactId, message) => {
    try {
      const historyPath = path.join(SESSIONS_DIR, sessionId, "conversation-history.json");

      // Create empty history if it doesn't exist
      if (!(await fs.pathExists(historyPath))) {
        await fs.writeJson(historyPath, { conversations: {} }, { spaces: 2 });
      }

      // Read current history
      const history = await fs.readJson(historyPath);

      // Initialize conversation array if it doesn't exist
      if (!history.conversations[contactId]) {
        history.conversations[contactId] = [];
      }

      // Add message to conversation
      history.conversations[contactId].push({
        ...message,
        timestamp: new Date().toISOString(),
      });

      // Get config to check context limit
      const config = await getAIConfig(sessionId);
      const contextLimit = config.contextLimit || DEFAULT_CONTEXT_LIMIT;

      // Trim conversation to context limit
      if (history.conversations[contactId].length > contextLimit) {
        history.conversations[contactId] = history.conversations[contactId].slice(-contextLimit);
      }

      // Save updated history
      await fs.writeJson(historyPath, history, { spaces: 2 });

      return history.conversations[contactId];
    } catch (error) {
      console.error(`Failed to add to conversation history: ${error.message}`);
      throw new Error(`Failed to update conversation history: ${error.message}`);
    }
  };

  /**
   * Clear conversation history for a contact
   * @param {string} sessionId - The session ID
   * @param {string} contactId - The contact ID (phone number)
   * @returns {Promise<boolean>} Success status
   */
  const clearConversationHistory = async (sessionId, contactId) => {
    try {
      const historyPath = path.join(SESSIONS_DIR, sessionId, "conversation-history.json");

      // If history doesn't exist, nothing to clear
      if (!(await fs.pathExists(historyPath))) {
        return true;
      }

      // Read current history
      const history = await fs.readJson(historyPath);

      // Clear conversation for this contact
      if (history.conversations[contactId]) {
        history.conversations[contactId] = [];
      }

      // Save updated history
      await fs.writeJson(historyPath, history, { spaces: 2 });

      return true;
    } catch (error) {
      console.error(`Failed to clear conversation history: ${error.message}`);
      throw new Error(`Failed to clear conversation history: ${error.message}`);
    }
  };

  /**
   * Process an incoming message with AI
   * @param {string} sessionId - The session ID
   * @param {string} contactId - The contact ID (phone number)
   * @param {string} message - The message text
   * @returns {Promise<Object>} The AI response
   */
  const processMessage = async (sessionId, contactId, message) => {
    try {
      // Get AI configuration
      const config = await getAIConfig(sessionId);

      // Check if AI is enabled
      if (!config.enabled) {
        return {
          processed: false,
          reason: "AI is disabled for this session",
        };
      }

      // Add user message to conversation history
      await addToConversationHistory(sessionId, contactId, {
        role: "user",
        content: message,
      });

      // Get conversation history for context
      const conversationHistory = await getConversationHistory(
        sessionId,
        contactId,
        config.contextLimit
      );

      // Prepare messages for AI
      const messages = [{ role: "system", content: config.instructions }, ...conversationHistory];

      // Generate AI response (placeholder for actual API call)
      const aiResponse = await generateAIResponse(messages, config);

      // Add AI response to conversation history
      await addToConversationHistory(sessionId, contactId, {
        role: "assistant",
        content: aiResponse.content,
      });

      // Emit event for real-time updates
      io.emit(`${sessionId}.ai.response`, {
        sessionId,
        contactId,
        response: aiResponse,
      });

      return {
        processed: true,
        response: aiResponse,
        autoReply: config.autoReply,
      };
    } catch (error) {
      console.error(`AI processing error: ${error.message}`);

      // Log error to conversation history
      await addToConversationHistory(sessionId, contactId, {
        role: "system",
        content: `Error processing message: ${error.message}`,
        error: true,
      });

      return {
        processed: false,
        error: error.message,
      };
    }
  };

  /**
   * Generate AI response (placeholder for actual API implementation)
   * @param {Array} messages - The conversation messages
   * @param {Object} config - The AI configuration
   * @returns {Promise<Object>} The AI response
   */
  const generateAIResponse = async (messages, config) => {
    // This is a placeholder for the actual API call
    // In a real implementation, this would call the OpenAI API or another AI service

    // For now, return a mock response
    return {
      id: uuidv4(),
      content:
        "This is a placeholder AI response. To implement actual AI responses, you need to integrate with an AI service API like OpenAI.",
      model: config.model,
      created: new Date().toISOString(),
    };
  };

  /**
   * Test AI configuration with a sample message
   * @param {string} sessionId - The session ID
   * @param {string} testMessage - The test message
   * @returns {Promise<Object>} The test result
   */
  const testAIConfig = async (sessionId, testMessage) => {
    try {
      // Get AI configuration
      const config = await getAIConfig(sessionId);

      // Create a test conversation
      const testConversation = [
        { role: "system", content: config.instructions },
        { role: "user", content: testMessage },
      ];

      // Generate AI response
      const aiResponse = await generateAIResponse(testConversation, config);

      return {
        success: true,
        testMessage,
        response: aiResponse,
        config,
      };
    } catch (error) {
      console.error(`AI test error: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  };

  return {
    initializeAIConfig,
    getAIConfig,
    updateAIConfig,
    getConversationHistory,
    addToConversationHistory,
    clearConversationHistory,
    processMessage,
    testAIConfig,
  };
};
