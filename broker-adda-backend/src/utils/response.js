export const successResponse = (res, message, data = null, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
};

export const errorResponse = (res, message, statusCode = 400, error = null) => {
  return res.status(statusCode).json({
    success: false,
    message,
    error: error || message
  });
};

export const serverError = (res, error) => {
  console.error('Server Error:', error);
  return res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
};

