// Auto-detect platform from request headers
export const detectPlatform = (req, res, next) => {
  // Only detect Android if x-platform header is 'android'
  if (req.headers['x-platform'] === 'android') {
    req.platform = 'android';
  }
  // Everything else is treated as WEB (including all browsers, API clients, etc.)
  else {
    req.platform = 'web';
  }
  
  next();
};


