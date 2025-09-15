import User from '../models/User.js';
import BrokerDetail from '../models/BrokerDetail.js';
import CustomerDetail from '../models/CustomerDetail.js';
import Region from '../models/Region.js';
import { generateToken, generateOTP } from '../utils/jwt.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';
import { getFileUrl } from '../middleware/upload.js';

// Temporary OTP storage (in production, use Redis)
const tempOTPStorage = new Map();

// Phone-based registration (Android: auto-broker, Web: role selection)
export const phoneRegistration = async (req, res) => {
  try {
    const { phone, role } = req.body;
    const platform = req.platform; // Auto-detected from middleware

    // For Android, auto-assign broker role (ignore provided role)
    if (platform === 'android') {
      // Check if user already exists with this phone number (ANY role)
      const existingUser = await User.findOne({ phone });
      
      if (existingUser) {
        return errorResponse(res, `Phone number ${phone} is already registered as ${existingUser.role}. Please use a different phone number or login with existing account.`, 409);
      }

      // Generate OTP for verification (don't save user yet)
      const otp = generateOTP();
      
      // Store OTP temporarily with registration data (always broker for Android)
      tempOTPStorage.set(phone, {
        otp: otp,
        role: 'broker', // Always broker for Android
        platform: platform,
        type: 'registration',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
      });

      // TODO: Send OTP via SMS
      console.log(`Android Registration OTP for ${phone}: ${otp}`);
      console.log('Android Registration data:', { phone, role: 'broker', platform });

      return successResponse(res, 'OTP sent to your phone number. Please verify to continue.', {
        phone: phone,
        role: 'broker', // Always broker for Android
        platform: platform,
        otp: otp, // Send OTP in response for testing
      hardcodedOtp: '123456', // Also provide hardcoded OTP for easy testing
      message: 'Use the generated OTP or hardcoded OTP: 123456'
    }, 201);
    }

    // For Web, allow broker and customer roles
    if (platform === 'web' && !['broker', 'customer'].includes(role)) {
      return errorResponse(res, 'Web app only supports broker and customer registration', 400);
    }

    // Check if user already exists with this phone number (ANY role)
    const existingUser = await User.findOne({ phone });

    if (existingUser) {
      return errorResponse(res, `Phone number ${phone} is already registered as ${existingUser.role}. Please use a different phone number or login with existing account.`, 409);
    }

    // Check if OTP is already pending for this phone
    // if (tempOTPStorage.has(phone)) {
    //   return errorResponse(res, `OTP already sent to ${phone}. Please wait for verification or try again after 10 minutes.`, 429);
    // }

    // Generate OTP for verification (don't save user yet)
    const otp = generateOTP();
    
    // Store OTP temporarily with registration data
    tempOTPStorage.set(phone, {
      otp: otp,
      role: role,
      platform: platform,
      type: 'registration',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    });

    // TODO: Send OTP via SMS
    console.log(`Web Registration OTP for ${phone}: ${otp}`);
    console.log('Web Registration data:', { phone, role, platform });

    return successResponse(res, 'OTP sent to your phone number. Please verify to continue.', {
      phone: phone,
      role: role,
      platform: platform,
      otp: otp, // Send OTP in response for testing
      hardcodedOtp: '123456', // Also provide hardcoded OTP for easy testing
      message: 'Use the generated OTP or hardcoded OTP: 123456'
    }, 201);

  } catch (error) {
    return serverError(res, error);
  }
};

// Admin login (hard-coded email/password)
export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Hard-coded admin credentials
    const adminCredentials = {
      email: process.env.ADMIN_EMAIL || 'admin@brokeradda.com',
      password: process.env.ADMIN_PASSWORD || 'admin123'
    };

    if (email !== adminCredentials.email || password !== adminCredentials.password) {
      return errorResponse(res, 'Invalid admin credentials', 401);
    }

    // Find or create admin user
    let admin = await User.findOne({ role: 'admin' });
    
    if (!admin) {
      admin = new User({
        name: 'Admin',
        email: adminCredentials.email,
        passwordHash: password,
        role: 'admin',
        status: 'active',
        isEmailVerified: true,
        isPhoneVerified: true
      });
      await admin.save();
    }

    // Generate token
    const token = generateToken({
      userId: admin._id,
      email: admin.email,
      role: admin.role
    });

    // Save token in admin user document
    admin.token = token;
    admin.tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await admin.save();

    return successResponse(res, 'Admin login successful', {
      token,
      user: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        status: admin.status
      }
    });

  } catch (error) {
    return serverError(res, error);
  }
};

// Unified login (for both Android and Web)
export const phoneLogin = async (req, res) => {
  try {
    const { phone } = req.body;
    const platform = req.platform; // Auto-detected from middleware

    // Find user by phone
    const user = await User.findOne({ phone });
    
    if (!user) {
      // User not found - handle based on platform
      if (platform === 'android') {
        // Android: Store data temporarily, don't create user yet
        const otp = generateOTP();
        
        // Store OTP temporarily with login data (always broker for Android)
        tempOTPStorage.set(phone, {
          otp: otp,
          role: 'broker', // Always broker for Android
          platform: platform,
          type: 'login',
          userId: null, // No user ID yet
          expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
        });

        // TODO: Send OTP via SMS
        console.log(`Android Login OTP for new broker ${phone}: ${otp}`);

        return successResponse(res, 'OTP sent to your phone number. Please verify to create your broker account.', {
          phone: phone,
          role: 'broker',
          isNewUser: true,
          otp: otp, // Send OTP in response for testing
          hardcodedOtp: '123456', // Also provide hardcoded OTP for easy testing
          message: 'Use the generated OTP or hardcoded OTP: 123456'
        });
      } else {
        // Web: Don't auto-create, redirect to registration
        return errorResponse(res, 'User not found. Please register first.', 404, {
          redirectToRegister: true,
          message: 'This number is not registered. Please go to the registration page to create an account.'
        });
      }
    }

    // User exists - check platform restrictions
    if (platform === 'android' && user.role !== 'broker') {
      return errorResponse(res, 'This number is registered as customer, not broker. Please use the website to login.', 400);
    }

    if (platform === 'web' && !['broker', 'customer'].includes(user.role)) {
      return errorResponse(res, 'Invalid user role for web login', 400);
    }

    // Generate OTP for verification
    const otp = generateOTP();
    
    // Store OTP temporarily for login
    tempOTPStorage.set(phone, {
      otp: otp,
      role: user.role,
      platform: platform,
      type: 'login',
      userId: user._id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    });

    // TODO: Send OTP via SMS
    console.log(`Login OTP for ${phone}: ${otp}`);

    return successResponse(res, 'OTP sent to your phone number. Please verify to login.', {
      phone: user.phone,
      role: user.role,
      isNewUser: false,
      otp: otp, // Send OTP in response for testing
      hardcodedOtp: '123456', // Also provide hardcoded OTP for easy testing
      message: 'Use the generated OTP or hardcoded OTP: 123456'
    });

  } catch (error) {
    return serverError(res, error);
  }
};

// Verify OTP (for both registration and login)
export const verifyOTP = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    
    console.log('OTP Verification Request:', { phone, otp });

    // Check temporary OTP storage
    const tempData = tempOTPStorage.get(phone);
    
    if (!tempData) {
      return errorResponse(res, 'OTP not found or expired', 400);
    }

    // Verify OTP - allow hardcoded OTP as alternative
    if (tempData.otp !== otp && otp !== '123456') {
      return errorResponse(res, 'Invalid OTP', 400);
    }

    // Check if OTP expired
    if (tempData.expiresAt < new Date()) {
      tempOTPStorage.delete(phone);
      return errorResponse(res, 'OTP expired', 400);
    }

    // Handle registration flow
    if (tempData.type === 'registration') {
      // Check if user already exists (double-check)
      const existingUser = await User.findOne({ phone });
      
      if (existingUser) {
        tempOTPStorage.delete(phone);
        return errorResponse(res, `Phone number ${phone} is already registered as ${existingUser.role}. Please login instead.`, 409);
      }

      // Create user only after OTP verification
      const user = new User({
        phone: phone,
        role: tempData.role,
        status: 'pending',
        isPhoneVerified: true
      });
      await user.save();

      // Create role-specific details
      let roleDetails = null;
      
      if (user.role === 'broker') {
        const brokerDetail = new BrokerDetail({
          userId: user._id,
          firmName: '',
          region: [],
          kycDocs: {
            aadhar: '',
            pan: '',
            gst: ''
          },
          brokerImage: 'https://www.w3schools.com/howto/img_avatar.png',
          status: 'active',
          approvedByAdmin: false
        });
        await brokerDetail.save();
        roleDetails = brokerDetail;
        console.log('Broker details created during registration OTP verification');
      }

      if (user.role === 'customer') {
        const customerDetail = new CustomerDetail({
          userId: user._id,
          preferences: {
            budgetMin: 0,
            budgetMax: 0,
            propertyType: [],
            region: []
          },
          savedSearches: [],
          inquiryCount: 0,
          images: {
            customerImage: 'https://www.w3schools.com/howto/img_avatar.png'
          }
        });
        await customerDetail.save();
        roleDetails = customerDetail;
        console.log('Customer details created during registration OTP verification');
      }

      // Clean up temporary storage
      tempOTPStorage.delete(phone);

      // Generate token for registration
      const token = generateToken({
        userId: user._id,
        phone: user.phone,
        role: user.role
      });

      // Save token in user document
      user.token = token;
      user.tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      await user.save();

      return successResponse(res, 'Registration successful. Please complete your profile.', {
        token,
        phone: user.phone,
        role: user.role,
        needsProfileCompletion: true,
        user: {
          id: user._id,
          phone: user.phone,
          role: user.role,
          status: user.status
        }
      });
    }

    // Handle login flow
    if (tempData.type === 'login') {
      let user;
      
      if (tempData.userId) {
        // Existing user login
        user = await User.findById(tempData.userId);
        
        if (!user) {
          tempOTPStorage.delete(phone);
          return errorResponse(res, 'User not found', 404);
        }
      } else {
        // New Android user login - create user now
        user = new User({
          phone: phone,
          role: tempData.role, // Always broker for Android
          status: 'pending',
          isPhoneVerified: true
        });
        await user.save();
        console.log('New Android user created during login OTP verification');
      }

      // Mark as verified
      user.isPhoneVerified = true;
      await user.save();

      // Create role-specific details if they don't exist
      let roleDetails = null;
      
      if (user.role === 'broker') {
        let brokerDetail = await BrokerDetail.findOne({ userId: user._id });
        if (!brokerDetail) {
          brokerDetail = new BrokerDetail({
            userId: user._id,
            firmName: '',
            region: [],
            kycDocs: {
              aadhar: '',
              pan: '',
              gst: ''
            },
            status: 'active',
            approvedByAdmin: false
          });
          await brokerDetail.save();
          console.log('Broker details created during login OTP verification');
        }
        roleDetails = brokerDetail;
      }

      if (user.role === 'customer') {
        let customerDetail = await CustomerDetail.findOne({ userId: user._id });
        if (!customerDetail) {
          customerDetail = new CustomerDetail({
            userId: user._id,
            preferences: {
              budgetMin: 0,
              budgetMax: 0,
              propertyType: [],
              region: []
            },
            savedSearches: [],
            inquiryCount: 0
          });
          await customerDetail.save();
          console.log('Customer details created during login OTP verification');
        }
        roleDetails = customerDetail;
      }

      // Clean up temporary storage
      tempOTPStorage.delete(phone);

      // Generate token for login (always)
      const token = generateToken({
        userId: user._id,
        phone: user.phone,
        role: user.role
      });

      // Save token in user document
      user.token = token;
      user.tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // If user has complete profile, activate account
      if (user.name && user.email) {
        user.status = 'active';
        await user.save();

        return successResponse(res, 'Login successful', {
          token,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            status: user.status
          }
        });
      } else {
        await user.save();
        return successResponse(res, 'OTP verified. Please complete your profile.', {
          token,
          phone: user.phone,
          role: user.role,
          needsProfileCompletion: true,
          user: {
            id: user._id,
            phone: user.phone,
            role: user.role,
            status: user.status
          }
        });
      }
    }

    // Clean up temporary storage
    tempOTPStorage.delete(phone);
    return errorResponse(res, 'Invalid OTP type', 400);

  } catch (error) {
    return serverError(res, error);
  }
};

// Complete profile after OTP verification
export const completeProfile = async (req, res) => {
  try {
    const { phone, name, email, ...roleSpecificData } = req.body;
    const files = req.files;

    const user = await User.findOne({ phone });
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    if (!user.isPhoneVerified) {
      return errorResponse(res, 'Please verify your phone number first', 400);
    }

    // Validate role-specific data based on user role
    if (user.role === 'broker' && !roleSpecificData.brokerDetails) {
      return errorResponse(res, 'Broker details are required for broker users', 400);
    }

    if (user.role === 'customer' && !roleSpecificData.customerDetails) {
      return errorResponse(res, 'Customer details are required for customer users', 400);
    }

    // Validate region existence for broker
    if (user.role === 'broker' && roleSpecificData.brokerDetails?.region) {
      const regionIds = roleSpecificData.brokerDetails.region;
      for (const regionId of regionIds) {
        const region = await Region.findById(regionId);
        if (!region) {
          return errorResponse(res, `Region not found: ${regionId}`, 400);
        }
      }
    }

    // Validate region existence for customer
    if (user.role === 'customer' && roleSpecificData.customerDetails?.preferences?.region) {
      const regionIds = roleSpecificData.customerDetails.preferences.region;
      for (const regionId of regionIds) {
        const region = await Region.findById(regionId);
        if (!region) {
          return errorResponse(res, `Region not found: ${regionId}`, 400);
        }
      }
    }

    // Update user basic info
    user.name = name;
    user.email = email;
    user.isEmailVerified = true;
    user.status = 'active';
    await user.save();

    // Update existing role-specific details
    console.log('User role:', user.role);
    console.log('Role specific data:', roleSpecificData);
    
    if (user.role === 'broker' && roleSpecificData.brokerDetails) {
      console.log('Updating broker details...');
      const brokerDetail = await BrokerDetail.findOne({ userId: user._id });
      
      if (brokerDetail) {
        // Update existing broker details with user info
        Object.assign(brokerDetail, roleSpecificData.brokerDetails);
        brokerDetail.name = name;
        brokerDetail.email = email;
        brokerDetail.phone = phone;

        // Process uploaded files if any
        if (files) {
          // Process kycDocs (PDF files) - update existing kycDocs field
          if (files.aadhar) {
            brokerDetail.kycDocs.aadhar = getFileUrl(req, files.aadhar[0].path);
          }
          if (files.pan) {
            brokerDetail.kycDocs.pan = getFileUrl(req, files.pan[0].path);
          }
          if (files.gst) {
            brokerDetail.kycDocs.gst = getFileUrl(req, files.gst[0].path);
          }

          // Process broker image
          if (files.brokerImage) {
            brokerDetail.brokerImage = getFileUrl(req, files.brokerImage[0].path);
          }
        }

        await brokerDetail.save();
        console.log('Broker details updated successfully');
      } else {
        // Create new if not found (fallback)
        const newBrokerDetail = new BrokerDetail({
          userId: user._id,
          name: name,
          email: email,
          phone: phone,
          ...roleSpecificData.brokerDetails
        });

        // Process uploaded files if any
        if (files) {
          // Process kycDocs (PDF files) - update existing kycDocs field
          if (files.aadhar) {
            newBrokerDetail.kycDocs.aadhar = getFileUrl(req, files.aadhar[0].path);
          }
          if (files.pan) {
            newBrokerDetail.kycDocs.pan = getFileUrl(req, files.pan[0].path);
          }
          if (files.gst) {
            newBrokerDetail.kycDocs.gst = getFileUrl(req, files.gst[0].path);
          }

          // Process broker image
          if (files.brokerImage) {
            newBrokerDetail.brokerImage = getFileUrl(req, files.brokerImage[0].path);
          }
        }

        await newBrokerDetail.save();
        console.log('Broker details created successfully');
      }
    }

    if (user.role === 'customer' && roleSpecificData.customerDetails) {
      console.log('Updating customer details...');
      const customerDetail = await CustomerDetail.findOne({ userId: user._id });
      
      if (customerDetail) {
        // Update existing customer details with user info
        const { savedSearches, ...otherDetails } = roleSpecificData.customerDetails;
        
        // Update all fields except savedSearches
        Object.assign(customerDetail, otherDetails);
        
        // Handle savedSearches separately - replace the entire array
        if (savedSearches) {
          customerDetail.savedSearches = savedSearches;
          console.log('Saved searches updated:', savedSearches);
        }
        
        customerDetail.name = name;
        customerDetail.email = email;
        customerDetail.phone = phone;

        // Process uploaded files if any
        if (files && files.customerImage) {
          customerDetail.images = { ...customerDetail.images };
          customerDetail.images.customerImage = getFileUrl(req, files.customerImage[0].path);
        }

        await customerDetail.save();
        console.log('Customer details updated successfully');
        console.log('Final savedSearches in DB:', customerDetail.savedSearches);
      } else {
        // Create new if not found (fallback)
        const newCustomerDetail = new CustomerDetail({
          userId: user._id,
          name: name,
          email: email,
          phone: phone,
          ...roleSpecificData.customerDetails
        });

        // Process uploaded files if any
        if (files && files.customerImage) {
          newCustomerDetail.images = { ...newCustomerDetail.images };
          newCustomerDetail.images.customerImage = getFileUrl(req, files.customerImage[0].path);
        }

        await newCustomerDetail.save();
        console.log('Customer details created successfully');
      }
    }

    // Update token expiration (extend existing token)
    user.tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await user.save();

    // Prepare response data
    const responseData = {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status
      }
    };

    // Add file URLs to response if files were uploaded
    if (user.role === 'broker') {
      const brokerDetail = await BrokerDetail.findOne({ userId: user._id });
      if (brokerDetail) {
        responseData.files = {};
        
        if (brokerDetail.kycDocs) {
          responseData.files.kycDocs = {};
          Object.keys(brokerDetail.kycDocs).forEach(key => {
            if (brokerDetail.kycDocs[key]) {
              responseData.files.kycDocs[key] = getFileUrl(req, brokerDetail.kycDocs[key]);
            }
          });
        }

        if (brokerDetail.brokerImage) {
          responseData.files.brokerImage = getFileUrl(req, brokerDetail.brokerImage);
        } else {
          responseData.files.brokerImage = 'https://www.w3schools.com/howto/img_avatar.png';
        }
      }
    } else if (user.role === 'customer') {
      const customerDetail = await CustomerDetail.findOne({ userId: user._id });
      if (customerDetail && customerDetail.images) {
        responseData.files = {};
        responseData.files.images = {};
        Object.keys(customerDetail.images).forEach(key => {
          if (customerDetail.images[key]) {
            responseData.files.images[key] = getFileUrl(req, customerDetail.images[key]);
          }
        });
      } else {
        // Set default customer image if no customer details or images
        responseData.files = {
          images: {
            customerImage: 'https://www.w3schools.com/howto/img_avatar.png'
          }
        };
      }
    } else if (user.role === 'admin') {
      // Set default admin image
      responseData.files = {
        adminImage: 'https://www.w3schools.com/howto/img_avatar.png'
      };
    }

    return successResponse(res, 'Profile completed successfully', responseData);

  } catch (error) {
    return serverError(res, error);
  }
};


// Resend OTP
export const resendOTP = async (req, res) => {
  try {
    const { phone } = req.body;

    // Check if there's existing temporary OTP data
    const existingTempData = tempOTPStorage.get(phone);
    
    if (!existingTempData) {
      return errorResponse(res, 'No pending OTP found for this phone number', 404);
    }

    // Generate new OTP
    const otp = generateOTP();
    
    // Update existing temporary data with new OTP
    tempOTPStorage.set(phone, {
      ...existingTempData,
      otp: otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    });

    // TODO: Send OTP via SMS
    console.log(`New OTP for ${phone}: ${otp}`);

    return successResponse(res, 'OTP sent successfully', {
      phone: phone,
      role: existingTempData.role,
      platform: existingTempData.platform,
      type: existingTempData.type,
      otp: otp, // Include OTP in response for testing
      hardcodedOtp: '123456', // Also provide hardcoded OTP for easy testing
      message: 'Use the generated OTP or hardcoded OTP: 123456'
    });

  } catch (error) {
    return serverError(res, error);
  }
};

// Get profile
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-passwordHash -otp');
    
    let additionalDetails = null;
    
    if (user.role === 'broker') {
      additionalDetails = await BrokerDetail.findOne({ userId: user._id }).populate('regionId', 'name description');
    } else if (user.role === 'customer') {
      additionalDetails = await CustomerDetail.findOne({ userId: user._id }).populate('preferences.region', 'name description');
    }

    return successResponse(res, 'Profile retrieved successfully', {
      user,
      additionalDetails
    });

  } catch (error) {
    return serverError(res, error);
  }
};

// Update profile
export const updateProfile = async (req, res) => {
  try {
    const { name, phone } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    if (name) user.name = name;
    if (phone) {
      // Check if phone is already taken
      const existingUser = await User.findOne({ phone, _id: { $ne: userId } });
      if (existingUser) {
        return errorResponse(res, 'Phone number already in use', 400);
      }
      user.phone = phone;
      user.isPhoneVerified = false; // Require re-verification
    }

    await user.save();

    return successResponse(res, 'Profile updated successfully', {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status
      }
    });

  } catch (error) {
    return serverError(res, error);
  }
};
