const fs = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const OpenAI = require("openai");
const cacheManager = require("./cacheManager");
const helpers = require("./helpers");

// Constants
const SESSIONS_DIR = path.join(process.cwd(), "sessions");
const DEFAULT_CONTEXT_LIMIT = 10; // Number of messages to keep in context
const DEFAULT_MAX_TOKENS = 150; // Default max tokens for AI response

// AI Service Providers
const AI_PROVIDERS = {
  OPENAI: "openai",
  DEEPSEEK: "deepseek",
};

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
      provider: AI_PROVIDERS.OPENAI,
      openaiApiKey: "",
      deepseekApiKey: "",
      instructions: "You are a helpful assistant...",
      model: "gpt-3.5-turbo",
      maxTokens: DEFAULT_MAX_TOKENS,
      temperature: 0.7,
      contextLimit: DEFAULT_CONTEXT_LIMIT,
      autoReply: false,

      // Typing and reading simulation settings
      simulateTyping: true,
      typingDelay: 50, // ms per character
      readingDelay: 200, // ms per word
      minDelay: 1000, // minimum delay in ms
      maxDelay: 10000, // maximum delay in ms

      // Cache settings
      caching: {
        enabled: true,
        useMemoryCache: true,
        useFileCache: true,
        memoryCacheSize: 100, // Number of items to keep in memory cache
        ttl: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
      },

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

      // Simulate reading time if enabled
      if (config.simulateTyping) {
        const readingDelay = helpers.calculateReadingDelay(message, config);
        await helpers.delay(readingDelay);
      }

      // Get conversation history for context
      const conversationHistory = await getConversationHistory(
        sessionId,
        contactId,
        config.contextLimit
      );

      // Prepare messages for AI
      const messages = [{ role: "system", content: config.instructions }, ...conversationHistory];

      // Generate AI response
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
   * Generate AI response using the configured provider
   * @param {Array} messages - The conversation messages
   * @param {Object} config - The AI configuration
   * @returns {Promise<Object>} The AI response
   */
  const generateAIResponse = async (messages, config) => {
    try {
      // Generate cache key
      const cacheKey = cacheManager.generateCacheKey(messages, config);

      // Check if caching is enabled and try to get from cache
      if (config.caching && config.caching.enabled) {
        const cachedResponse = await cacheManager.getCacheItem(cacheKey, config.caching);
        if (cachedResponse) {
          console.log(`Using cached response for key: ${cacheKey}`);

          // Add cache info to the response
          return {
            ...cachedResponse,
            fromCache: true,
            cacheKey: cacheKey,
          };
        }
      }

      // Not in cache, generate response from provider
      let response;
      switch (config.provider) {
        case AI_PROVIDERS.OPENAI:
          response = await generateOpenAIResponse(messages, config);
          break;
        case AI_PROVIDERS.DEEPSEEK:
          response = await generateDeepSeekResponse(messages, config);
          break;
        default:
          response = {
            id: uuidv4(),
            content: `Unknown AI provider: ${config.provider}. Please select a valid provider in the AI settings.`,
            model: config.model,
            created: new Date().toISOString(),
          };
      }

      // Cache the response if caching is enabled
      if (config.caching && config.caching.enabled && !response.error) {
        console.log(`Caching response for key: ${cacheKey}`);
        await cacheManager.setCacheItem(cacheKey, response, config.caching);
      }

      return response;
    } catch (error) {
      console.error(`Error in generateAIResponse: ${error.message}`);

      // Return a fallback response
      return {
        id: uuidv4(),
        content: `Error generating AI response: ${error.message}`,
        model: config.model,
        created: new Date().toISOString(),
        error: error.message,
      };
    }
  };

  /**
   * Generate AI response using OpenAI API
   * @param {Array} messages - The conversation messages
   * @param {Object} config - The AI configuration
   * @returns {Promise<Object>} The AI response
   */
  const generateOpenAIResponse = async (messages, config) => {
    try {
      // Check if API key is provided
      if (!config.openaiApiKey) {
        return {
          id: uuidv4(),
          content:
            "OpenAI API key is not configured. Please add your OpenAI API key in the AI settings.",
          model: config.model,
          created: new Date().toISOString(),
        };
      }

      // Initialize OpenAI client
      const openai = new OpenAI({
        apiKey: config.openaiApiKey,
      });

      try {
        // Call OpenAI API
        const response = await openai.chat.completions.create({
          model: config.model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          max_tokens: config.maxTokens,
          temperature: config.temperature,
        });

        // Extract the response
        const result = response.choices[0].message;

        return {
          id: response.id,
          content: result.content,
          model: config.model,
          provider: AI_PROVIDERS.OPENAI,
          created: new Date(response.created * 1000).toISOString(),
          usage: response.usage,
        };
      } catch (error) {
        console.error(`OpenAI API error: ${error.message}`);

        // Return a fallback response
        return {
          id: uuidv4(),
          content: `Error generating OpenAI response: ${error.message}. Please check your API key and settings.`,
          model: config.model,
          provider: AI_PROVIDERS.OPENAI,
          created: new Date().toISOString(),
          error: error.message,
        };
      }
    } catch (error) {
      console.error(`Error in generateOpenAIResponse: ${error.message}`);

      // Return a fallback response
      return {
        id: uuidv4(),
        content: `Error generating OpenAI response: ${error.message}`,
        model: config.model,
        provider: AI_PROVIDERS.OPENAI,
        created: new Date().toISOString(),
        error: error.message,
      };
    }
  };

  /**
   * Generate AI response using DeepSeek API
   * @param {Array} messages - The conversation messages
   * @param {Object} config - The AI configuration
   * @returns {Promise<Object>} The AI response
   */
  const generateDeepSeekResponse = async (messages, config) => {
    try {
      // Check if API key is provided
      if (!config.deepseekApiKey) {
        return {
          id: uuidv4(),
          content:
            "DeepSeek API key is not configured. Please add your DeepSeek API key in the AI settings.",
          model: config.model,
          created: new Date().toISOString(),
        };
      }

      // Initialize DeepSeek client
      const deepseek = new OpenAI({
        baseURL: "https://api.deepseek.com",
        apiKey: config.deepseekApiKey,
      });

      try {
        // Map models to DeepSeek models if needed
        let deepseekModel = config.model;
        if (config.model.startsWith("gpt-")) {
          // If using an OpenAI model name, map to equivalent DeepSeek model
          switch (config.model) {
            case "gpt-3.5-turbo":
              deepseekModel = "deepseek-chat";
              break;
            case "gpt-4":
            case "gpt-4-turbo":
            case "gpt-4o":
              deepseekModel = "deepseek-chat-pro";
              break;
            default:
              deepseekModel = "deepseek-chat";
          }
        }

        // Call DeepSeek API
        const response = await deepseek.chat.completions.create({
          model: deepseekModel,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          max_tokens: config.maxTokens,
          temperature: config.temperature,
        });

        // Extract the response
        const result = response.choices[0].message;

        return {
          id: response.id || uuidv4(),
          content: result.content,
          model: deepseekModel,
          provider: AI_PROVIDERS.DEEPSEEK,
          created: new Date().toISOString(),
          usage: response.usage,
        };
      } catch (error) {
        console.error(`DeepSeek API error: ${error.message}`);

        // Return a fallback response
        return {
          id: uuidv4(),
          content: `Error generating DeepSeek response: ${error.message}. Please check your API key and settings.`,
          model: config.model,
          provider: AI_PROVIDERS.DEEPSEEK,
          created: new Date().toISOString(),
          error: error.message,
        };
      }
    } catch (error) {
      console.error(`Error in generateDeepSeekResponse: ${error.message}`);

      // Return a fallback response
      return {
        id: uuidv4(),
        content: `Error generating DeepSeek response: ${error.message}`,
        model: config.model,
        provider: AI_PROVIDERS.DEEPSEEK,
        created: new Date().toISOString(),
        error: error.message,
      };
    }
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

  /**
   * Clear AI response cache
   * @param {string} sessionId - The session ID (optional, if not provided clears all cache)
   * @returns {Promise<Object>} Result of the operation
   */
  const clearCache = async (sessionId) => {
    try {
      // If sessionId is provided, only clear cache for that session
      // For now, we clear all cache since we don't have session-specific caching
      await cacheManager.clearAllCache();

      return {
        success: true,
        message: sessionId ? `Cache cleared for session ${sessionId}` : "All cache cleared",
      };
    } catch (error) {
      console.error(`Error clearing cache: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  };

  /**
   * Get cache statistics
   * @returns {Promise<Object>} Cache statistics
   */
  const getCacheStats = async () => {
    try {
      return await cacheManager.getCacheStats();
    } catch (error) {
      console.error(`Error getting cache stats: ${error.message}`);
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
    clearCache,
    getCacheStats,
  };
};
