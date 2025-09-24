import Joi from 'joi';

// Phone-based registration schema
export const phoneRegistrationSchema = Joi.object({
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required(),
  role: Joi.string().valid('broker', 'customer').optional() // Optional for Android
});

// Admin login schema
export const adminLoginSchema = Joi.object({
  email: Joi.string().email().required().lowercase(),
  password: Joi.string().required()
});

// Phone-based login schema
export const phoneLoginSchema = Joi.object({
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required()
});

// OTP verification schema
export const otpVerificationSchema = Joi.object({
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required(),
  otp: Joi.string().length(6).required()
});

// Resend OTP schema
export const resendOtpSchema = Joi.object({
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required()
});

export const adminCreateBrokerSchema = Joi.object({
  name:  Joi.string().trim().min(2).max(80).required(),
  email: Joi.string().email().lowercase().required(),
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required(),
}).unknown(true);