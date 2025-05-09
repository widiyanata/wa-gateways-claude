// Helper functions
function getRandomTime(
  minHour = 0,
  maxHour = 23,
  minMinute = 0,
  maxMinute = 59,
  minSecond = 0,
  maxSecond = 59,
  minFutureMinutes = 3
) {
  // Get current time
  const now = new Date();

  // Calculate minimum allowed time (current time + minFutureMinutes minutes)
  const minTime = new Date(now.getTime() + minFutureMinutes * 60000);

  // Extract minimum required hours, minutes, seconds from minTime
  const minTimeHour = minTime.getHours();
  const minTimeMinute = minTime.getMinutes();
  const minTimeSecond = minTime.getSeconds();

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

  // Adjust min values to ensure we're not below the current time + offset
  if (minTimeHour > minHour) {
    minHour = minTimeHour;
  } else if (minTimeHour === minHour) {
    if (minTimeMinute > minMinute) {
      minMinute = minTimeMinute;
    } else if (minTimeMinute === minMinute) {
      if (minTimeSecond > minSecond) {
        minSecond = minTimeSecond;
      }
    }
  }

  // If min values are now greater than max values, adjust max values
  if (minHour > maxHour) {
    // Can't satisfy both constraints, so prioritize the future time requirement
    maxHour = Math.min(23, minHour);
  }
  if (minHour === maxHour && minMinute > maxMinute) {
    maxMinute = Math.min(59, minMinute);
  }
  if (minHour === maxHour && minMinute === maxMinute && minSecond > maxSecond) {
    maxSecond = Math.min(59, minSecond);
  }

  // Generate random components within the adjusted ranges
  const hours = String(Math.floor(minHour + Math.random() * (maxHour - minHour + 1))).padStart(
    2,
    "0"
  );

  // Handle minutes based on hour selection
  let minutes;
  if (parseInt(hours) === minHour) {
    minutes = String(Math.floor(minMinute + Math.random() * (maxMinute - minMinute + 1))).padStart(
      2,
      "0"
    );
  } else {
    minutes = String(Math.floor(minMinute + Math.random() * (maxMinute - minMinute + 1))).padStart(
      2,
      "0"
    );
  }

  // Handle seconds based on hour and minute selection
  let seconds;
  if (parseInt(hours) === minHour && parseInt(minutes) === minMinute) {
    seconds = String(Math.floor(minSecond + Math.random() * (maxSecond - minSecond + 1))).padStart(
      2,
      "0"
    );
  } else {
    seconds = String(Math.floor(minSecond + Math.random() * (maxSecond - minSecond + 1))).padStart(
      2,
      "0"
    );
  }

  return `${hours}:${minutes}:${seconds}`;
}

function renderTemplate(template, data) {
  // Enhanced template rendering with error checking
  return template.replace(/{{\s*(\w+)\s*}}/g, (match, key) => {
    return data[key] !== undefined ? data[key] : match;
  });
}

function formatDateToYYYYMMDD(dateString) {
  try {
    if (!dateString) {
      // If no date provided, use today's date
      const today = new Date();
      return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
        today.getDate()
      ).padStart(2, "0")}`;
    }

    // If it's a Date object
    if (dateString instanceof Date) {
      return `${dateString.getFullYear()}-${String(dateString.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(dateString.getDate()).padStart(2, "0")}`;
    }

    // If already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return dateString;

    // Handle DD-MM-YYYY format
    if (/^\d{2}-\d{2}-\d{4}$/.test(dateString)) {
      const [day, month, year] = dateString.split("-");
      return `${year}-${month}-${day}`;
    }

    // Try to parse as date string
    const parsed = new Date(dateString);
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(
        parsed.getDate()
      ).padStart(2, "0")}`;
    }

    // If no format matches, use today's date
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;
  } catch (error) {
    console.error("Date formatting error:", error);
    // Default to today on error
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;
  }
}

/**
 * Validates Excel data for bulk messaging
 * Required columns: to, name
 * Optional columns: message, scheduledTime
 *
 * @param {Array} excelData - The parsed Excel data as an array of objects
 * @returns {Object} Validation result with status and details
 */
function validateExcelData(excelData) {
  // Check if data is an array and not empty
  if (!Array.isArray(excelData) || excelData.length === 0) {
    return {
      isValid: false,
      errors: ["Excel data is empty or not in the correct format"],
      validRows: [],
      invalidRows: [],
    };
  }

  const validRows = [];
  const invalidRows = [];
  const errors = [];

  // Check if required columns exist in the first row
  const firstRow = excelData[0];
  const hasToColumn =
    "to" in firstRow || "phone" in firstRow || "number" in firstRow || "no" in firstRow;
  const hasNameColumn = "name" in firstRow || "nama" in firstRow;

  if (!hasToColumn) {
    errors.push("Missing required 'to' column (alternatives: 'phone', 'number', 'no')");
  }

  if (!hasNameColumn) {
    errors.push("Missing required 'name' column (alternative: 'nama')");
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      errors,
      validRows: [],
      invalidRows: excelData,
    };
  }

  // Validate each row
  excelData.forEach((row, index) => {
    const rowErrors = [];
    const normalizedRow = {};

    // Normalize column names
    if ("to" in row) normalizedRow.to = row.to;
    else if ("phone" in row) normalizedRow.to = row.phone;
    else if ("number" in row) normalizedRow.to = row.number;
    else if ("no" in row) normalizedRow.to = row.no;
    else normalizedRow.to = null;

    if ("name" in row) normalizedRow.name = row.name;
    else if ("nama" in row) normalizedRow.name = row.nama;
    else normalizedRow.name = null;

    // Copy optional fields
    if ("message" in row) normalizedRow.message = row.message;
    if ("scheduledTime" in row) normalizedRow.scheduledTime = row.scheduledTime;
    else if ("scheduled_time" in row) normalizedRow.scheduledTime = row.scheduled_time;
    else if ("tanggal" in row) normalizedRow.scheduledTime = row.tanggal;

    // Validate phone number (basic validation)
    if (!normalizedRow.to) {
      rowErrors.push("Missing phone number");
    } else {
      // Format phone number (remove spaces, ensure it starts with proper format)
      let phoneNumber = String(normalizedRow.to).trim().replace(/\s+/g, "");

      // Basic validation (adjust as needed for your requirements)
      if (!/^[0-9+]+$/.test(phoneNumber)) {
        rowErrors.push("Phone number contains invalid characters");
      } else {
        // Ensure phone number starts with country code or add default
        if (!phoneNumber.startsWith("+") && !phoneNumber.startsWith("62")) {
          // Check if it starts with 0, replace with 62
          if (phoneNumber.startsWith("0")) {
            phoneNumber = "62" + phoneNumber.substring(1);
          } else {
            phoneNumber = "62" + phoneNumber;
          }
        }
        normalizedRow.to = phoneNumber;
      }
    }

    // Validate name
    if (!normalizedRow.name || String(normalizedRow.name).trim() === "") {
      rowErrors.push("Missing name");
    }

    // Add to appropriate list
    if (rowErrors.length === 0) {
      validRows.push(normalizedRow);
    } else {
      invalidRows.push({
        rowIndex: index,
        originalData: row,
        errors: rowErrors,
      });
    }
  });

  return {
    isValid: invalidRows.length === 0,
    errors: errors,
    validRows: validRows,
    invalidRows: invalidRows,
    stats: {
      total: excelData.length,
      valid: validRows.length,
      invalid: invalidRows.length,
    },
  };
}

/**
 * Calculate typing delay based on message length and typing speed
 * @param {string} message - The message to calculate typing time for
 * @param {Object} config - The AI configuration with typing settings
 * @returns {number} Delay in milliseconds
 */
const calculateTypingDelay = (message, config) => {
  if (!config.simulateTyping) return 0;

  const characterCount = message.length;
  const calculatedDelay = characterCount * config.typingDelay;

  // Apply min/max bounds
  return Math.min(Math.max(calculatedDelay, config.minDelay || 1000), config.maxDelay || 10000);
};

/**
 * Calculate reading delay based on message length and reading speed
 * @param {string} message - The message to calculate reading time for
 * @param {Object} config - The AI configuration with reading settings
 * @returns {number} Delay in milliseconds
 */
const calculateReadingDelay = (message, config) => {
  if (!config.simulateTyping) return 0;

  // Estimate word count (split by spaces and count non-empty segments)
  const wordCount = message.split(/\s+/).filter(Boolean).length;
  const calculatedDelay = wordCount * config.readingDelay;

  // Apply min/max bounds
  return Math.min(Math.max(calculatedDelay, config.minDelay || 1000), config.maxDelay || 10000);
};

/**
 * Create a promise that resolves after the specified delay
 * @param {number} ms - Delay in milliseconds
 * @returns {Promise} Promise that resolves after the delay
 */
const delay = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

function formatPhoneNumber(phoneNumber) {
  // Convert to string and remove any spaces or non-numeric characters
  let formatted = String(phoneNumber).trim().replace(/\s+/g, "");
  
  // Basic validation
  if (!/^[0-9+]+$/.test(formatted)) {
    return formatted; // Return as is if contains invalid characters
  }
  
  // Handle Indonesian numbers starting with 0
  if (formatted.startsWith("0")) {
    formatted = "62" + formatted.substring(1);
  }
  // Add 62 if number doesn't have country code
  else if (!formatted.startsWith("+") && !formatted.startsWith("62")) {
    formatted = "62" + formatted;
  }
  
  return formatted;
}

module.exports = {
  validateExcelData,
  getRandomTime,
  formatDateToYYYYMMDD,
  renderTemplate,
  calculateTypingDelay,
  calculateReadingDelay,
  delay,
  formatPhoneNumber,
};
