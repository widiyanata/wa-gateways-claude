// Helper functions
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

module.exports = { validateExcelData, getRandomTime, formatDateToYYYYMMDD, renderTemplate };
