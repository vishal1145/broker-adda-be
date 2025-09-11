import express from 'express';
import {
  phoneRegistration,
  adminLogin,
  phoneLogin,
  verifyOTP,
  completeProfile,
  resendOTP,
  getProfile,
  updateProfile
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { detectPlatform } from '../middleware/platform.js';
import {
  phoneRegistrationSchema,
  adminLoginSchema,
  phoneLoginSchema,
  otpVerificationSchema,
  resendOtpSchema
} from '../validations/auth.js';
import { completeProfileSchema } from '../validations/profile.js';

const router = express.Router();

// Public routes
router.post('/register', detectPlatform, validate(phoneRegistrationSchema), phoneRegistration);
router.post('/admin-login', validate(adminLoginSchema), adminLogin);
router.post('/login', detectPlatform, validate(phoneLoginSchema), phoneLogin);
router.post('/verify-otp', validate(otpVerificationSchema), verifyOTP);
router.post('/complete-profile', validate(completeProfileSchema), completeProfile);
router.post('/resend-otp', validate(resendOtpSchema), resendOTP);

// Protected routes
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);

export default router;
