import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { errorResponse } from '../utils/response.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');

// Ensure uploads directory and subdirectories exist
const ensureUploadsDir = () => {
  const dirs = [
    uploadsDir,
    path.join(uploadsDir, 'images'),
    path.join(uploadsDir, 'keydocs')
  ];
  
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created uploads directory: ${dir}`);
    }
  });
};

// Initialize directories on module load
ensureUploadsDir();

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = uploadsDir;
    
    // Create subdirectories based on file type
    if (file.fieldname.includes('keydocs') || file.mimetype === 'application/pdf') {
      uploadPath = path.join(uploadsDir, 'keydocs');
    } else if (file.fieldname.includes('image')) {
      uploadPath = path.join(uploadsDir, 'images');
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

// File filter function - Allow all file types
const fileFilter = (req, file, cb) => {
  // Allow all file types for all fields
  cb(null, true);
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 10 // Maximum 10 files
  }
});

// Middleware for kycDocs upload (PDF files)
export const uploadKycDocs = upload.fields([
  { name: 'aadhar', maxCount: 1 },
  { name: 'pan', maxCount: 1 },
  { name: 'gst', maxCount: 1 },
  { name: 'brokerLicense', maxCount: 1 },
  { name: 'companyId', maxCount: 1 }
]);

// Middleware for image uploads
export const uploadImages = upload.fields([
  { name: 'brokerImage', maxCount: 1 }
]);

// Middleware for all file uploads
export const uploadAllFiles = upload.fields([
  { name: 'aadhar', maxCount: 1 },
  { name: 'pan', maxCount: 1 },
  { name: 'gst', maxCount: 1 },
  { name: 'brokerLicense', maxCount: 1 },
  { name: 'companyId', maxCount: 1 },
  { name: 'brokerImage', maxCount: 1 },
  { name: 'customerImage', maxCount: 1 }
]);

// Middleware for property media uploads (arrays)
export const uploadPropertyMedia = upload.fields([
  // Accept both plain and [] suffixed names
  { name: 'images', maxCount: 10 },
  { name: 'images[]', maxCount: 10 },
  { name: 'videos', maxCount: 5 },
  { name: 'videos[]', maxCount: 5 }
]);

// Normalize images/videos fields before validation
// This handles cases where multipart/form-data sends empty strings or invalid values
export const normalizePropertyMedia = (req, res, next) => {
  // Normalize images field
  if (req.body.images !== undefined) {
    if (!Array.isArray(req.body.images)) {
      // If it's not an array, check if it's a valid value that can be converted
      if (req.body.images === null || req.body.images === '' || req.body.images === '[]') {
        // Treat as empty array (explicit removal)
        req.body.images = [];
      } else if (typeof req.body.images === 'string') {
        // Single string value, convert to array
        req.body.images = [req.body.images];
      } else {
        // Invalid type, remove from body to preserve existing (field not provided)
        delete req.body.images;
      }
    }
  } else {
    // Field not provided, ensure it's removed to avoid validation issues
    delete req.body.images;
  }

  // Normalize videos field
  if (req.body.videos !== undefined) {
    if (!Array.isArray(req.body.videos)) {
      // If it's not an array, check if it's a valid value that can be converted
      if (req.body.videos === null || req.body.videos === '' || req.body.videos === '[]') {
        // Treat as empty array (explicit removal)
        req.body.videos = [];
      } else if (typeof req.body.videos === 'string') {
        // Single string value, convert to array
        req.body.videos = [req.body.videos];
      } else {
        // Invalid type, remove from body to preserve existing (field not provided)
        delete req.body.videos;
      }
    }
  } else {
    // Field not provided, ensure it's removed to avoid validation issues
    delete req.body.videos;
  }

  next();
};

// Error handling middleware
export const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return errorResponse(res, 'File too large. Maximum size is 10MB.', 400);
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return errorResponse(res, 'Too many files. Maximum is 10 files.', 400);
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return errorResponse(res, 'Unexpected field name for file upload.', 400);
    }
    return errorResponse(res, error.message, 400);
  }
  
  if (error.message.includes('Invalid file type')) {
    return errorResponse(res, error.message, 400);
  }
  
  next(error);
};

// Helper function to get file URL
export const getFileUrl = (req, filePath) => {
  if (!filePath) return null;
  
  // If it's already a complete URL (starts with http/https), return as is
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath;
  }
  
  // For static files (uploads), always use the backend server URL
  // This ensures files are accessible even if BASE_URL points to frontend
  let baseUrl;
  const isUploadFile = filePath.includes('/uploads/') || filePath.includes('uploads');
  
  if (isUploadFile) {
    // For upload files, prioritize BACKEND_URL or STATIC_URL, then fallback to backend domain
    if (process.env.BACKEND_URL || process.env.STATIC_URL) {
      baseUrl = process.env.BACKEND_URL || process.env.STATIC_URL;
    } else if (process.env.NODE_ENV === 'production') {
      // Production: always use backend server for static files
      baseUrl = 'https://broker-adda-be.algofolks.com';
    } else {
      // Development: use request host (which should be backend)
      baseUrl = `${req.protocol}://${req.get('host')}`;
    }
  } else {
    // For non-upload files, use BASE_URL if available
    if (process.env.BASE_URL) {
      baseUrl = process.env.BASE_URL;
    } else if (process.env.NODE_ENV === 'production') {
      baseUrl = 'https://broker-adda-be.algofolks.com';
    } else {
      baseUrl = `${req.protocol}://${req.get('host')}`;
    }
  }
  
  // If it's a relative path starting with /uploads, just add the base URL
  if (filePath.startsWith('/uploads/')) {
    return `${baseUrl}${filePath}`;
  }
  
  // If it's an absolute file path, convert to relative URL
  const relativePath = filePath.replace(/\\/g, '/').replace(/.*\/uploads\//, '/uploads/');
  return `${baseUrl}${relativePath}`;
};
