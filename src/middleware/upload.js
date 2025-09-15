import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { errorResponse } from '../utils/response.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');

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
  { name: 'gst', maxCount: 1 }
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
  { name: 'brokerImage', maxCount: 1 },
  { name: 'customerImage', maxCount: 1 }
]);

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
  
  // If it's a relative path starting with /uploads, just add the base URL
  if (filePath.startsWith('/uploads/')) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return `${baseUrl}${filePath}`;
  }
  
  // If it's an absolute file path, convert to relative URL
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const relativePath = filePath.replace(/\\/g, '/').replace(/.*\/uploads\//, '/uploads/');
  return `${baseUrl}${relativePath}`;
};
