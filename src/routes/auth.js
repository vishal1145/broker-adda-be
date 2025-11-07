import express from 'express';
import {
  phoneRegistration,
  adminLogin,
  phoneLogin,
  verifyOTP,
  completeProfile,
  resendOTP,
  getProfile,
  updateProfile,
  checkEmailExists,
  adminCreateBroker,
  deleteAccount,
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { detectPlatform } from '../middleware/platform.js';
import { uploadAllFiles, handleUploadError } from '../middleware/upload.js';
import {
  phoneRegistrationSchema,
  adminLoginSchema,
  phoneLoginSchema,
  otpVerificationSchema,
  resendOtpSchema,
  adminCreateBrokerSchema
} from '../validations/auth.js';
import { completeProfileSchema } from '../validations/profile.js';

const router = express.Router();

/** Admin-only route (PROTECTED) */
router.post('/admin/broker', authenticate ,validate(adminCreateBrokerSchema) ,adminCreateBroker); // ✅ fixed name

/** Public routes */
router.post('/register', detectPlatform, validate(phoneRegistrationSchema), phoneRegistration);
router.post('/admin-login', validate(adminLoginSchema), adminLogin);
router.post('/login', detectPlatform, validate(phoneLoginSchema), phoneLogin);
router.post('/verify-otp', validate(otpVerificationSchema), verifyOTP);
router.post('/complete-profile', uploadAllFiles, handleUploadError, validate(completeProfileSchema), completeProfile);
router.post('/resend-otp', validate(resendOtpSchema), resendOTP);
router.get('/check-email', checkEmailExists);

// Protected routes
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.delete('/account', authenticate, deleteAccount);

export default router;
