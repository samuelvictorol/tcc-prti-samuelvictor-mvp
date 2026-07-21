class ApiError extends Error {
  constructor(statusCode, message, details, code) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
    Error.captureStackTrace?.(this, ApiError);
  }
}

module.exports = ApiError;
