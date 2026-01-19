import User from '../models/User.js';
import BrokerDetail from '../models/BrokerDetail.js';
import CustomerDetail from '../models/CustomerDetail.js';
import Region from '../models/Region.js';
import SavedProperty from '../models/SavedProperty.js';
import Notification from '../models/Notification.js';
import PropertyRating from '../models/PropertyRating.js';
import Property from '../models/Property.js';
import BrokerRating from '../models/BrokerRating.js';
import Payment from '../models/Payment.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import Subscription from '../models/Subscription.js';
import Lead from '../models/Lead.js';
import { generateToken, generateOTP, generateEmailVerificationToken } from '../utils/jwt.js';
import { successResponse, errorResponse, serverError } from '../utils/response.js';
import { getFileUrl } from '../middleware/upload.js';
import { updateRegionBrokerCount, updateMultipleRegionBrokerCounts } from '../utils/brokerCount.js';
import { geocodeAddress } from '../utils/geocode.js';
import { sendVerificationEmail, createNotification } from '../utils/notifications.js';
import mongoose from 'mongoose';
import { activateSubscription } from '../routes/payments.js';

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
        status: admin.status,
        isEmailVerified: admin.isEmailVerified,
        isPhoneVerified: admin.isPhoneVerified
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
        isPhoneVerified: true,

      });
      await user.save();

      // Create role-specific details
      let roleDetails = null;
      
      if (user.role === 'broker') {
        const brokerDetail = new BrokerDetail({
          userId: user._id,
          gender: 'male', // Default value, will be updated during profile completion
          firmName: '',
          licenseNumber: '',
          address: '',
          state: '',
          city: '',
          whatsappNumber: '',
          specializations: [],
          website: '',
          socialMedia: {
            linkedin: '',
            twitter: '',
            instagram: '',
            facebook: ''
          },
          region: [],
          kycDocs: {
            aadhar: '',
            pan: '',
            gst: '',
            brokerLicense: '',
            companyId: ''
          },
          brokerImage: 'https://www.vhv.rs/dpng/d/312-3120300_default-profile-hd-png-download.png',
          status: 'active',
          approvedByAdmin: 'unblocked',
          role: 'broker'
        });
        await brokerDetail.save();
        await activateSubscription({ userId: user._id, planType: 'Trial Plan', paymentDoc: { amount: 0 }, periodValue: 2, periodUnit: 'week', autoRenew: false });
        roleDetails = brokerDetail;
        console.log('Broker details created during registration OTP verification');

        // Create notifications for broker creation (non-blocking - fire and forget)
        // Notification to broker
        createNotification({
          userId: user._id,
          type: 'approval',
          title: 'Broker Account Created',
          message: 'Your broker account has been successfully created. Please complete your profile to get started.',
          priority: 'high',
          relatedEntity: {
            entityType: 'BrokerDetail',
            entityId: brokerDetail._id
          },
          activity: {
            action: 'created',
            actorId: user._id,
            actorName: user.name || 'You'
          },
          metadata: {
            brokerId: brokerDetail._id,
            status: 'pending'
          }
        }).catch(notifError => {
          console.error('Error creating broker creation notification to broker:', notifError);
        });

        // Notify all admin users
        User.find({ role: 'admin' })
          .select('_id name email')
          .then(admins => {
            admins.forEach(admin => {
              createNotification({
                userId: admin._id,
                type: 'approval',
                title: 'New Broker Registration',
                message: `A new broker account has been created${user.name ? ` by ${user.name}` : ''}${user.phone ? ` (${user.phone})` : ''}. Please review and approve.`,
                priority: 'medium',
                relatedEntity: {
                  entityType: 'BrokerDetail',
                  entityId: brokerDetail._id
                },
                activity: {
                  action: 'brokerCreated',
                  actorId: user._id,
                  actorName: user.name || 'New Broker'
                },
                metadata: {
                  brokerId: brokerDetail._id,
                  brokerName: user.name,
                  brokerPhone: user.phone,
                  brokerEmail: user.email
                }
              }).catch(notifError => {
                console.error(`Error creating broker creation notification to admin ${admin._id}:`, notifError);
              });
            });
          })
          .catch(error => {
            console.error('Error fetching admin users for broker creation notification:', error);
          });
      }

      if (user.role === 'customer') {
        const customerDetail = new CustomerDetail({
          userId: user._id,
          gender: 'male', // Default value, will be updated during profile completion
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

        const customerBrokerDetail = new BrokerDetail({
          userId: user._id,
          role: 'customer',
        });
        await customerBrokerDetail.save();

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
          status: user.status,
          email: user.email,
          isEmailVerified: user.isEmailVerified,
          isPhoneVerified: user.isPhoneVerified
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
            gender: 'male', // Default value, will be updated during profile completion
            firmName: '',
            licenseNumber: '',
            address: '',
            state: '',
            city: '',
            whatsappNumber: '',
            specializations: [],
            website: '',
            socialMedia: {
              linkedin: '',
              twitter: '',
              instagram: '',
              facebook: ''
            },
            region: [],
            kycDocs: {
              aadhar: '',
              pan: '',
              gst: '',
              brokerLicense: '',
              companyId: ''
            },
            status: 'active',
            approvedByAdmin: 'unblocked'
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
            gender: 'male', // Default value, will be updated during profile completion
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
            status: user.status,
            isEmailVerified: user.isEmailVerified,
            isPhoneVerified: user.isPhoneVerified
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
            status: user.status,
            email: user.email,
            isEmailVerified: user.isEmailVerified,
            isPhoneVerified: user.isPhoneVerified
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

    console.log("here is broker profile");
    console.log(req.body);

    const { 
      phone, name, email, content, aboutUs, experienceYears, experienceDescription, achievements, certifications, 
      aadhar, aadharFront, aadharBack, pan, panFront, panBack, gst, brokerLicense, companyId,
      removePanFront, removePanBack, removeAadharFront, removeAadharBack,isBotEnable,botResponseTime,
      ...roleSpecificData 
    } = req.body;

    console.log("hhre is profile edit data");
    console.log(req.body)


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

    // Validate region existence for customer (only if region is provided)
    if (user.role === 'customer' && roleSpecificData.customerDetails?.preferences?.region && roleSpecificData.customerDetails.preferences.region.length > 0) {
      const regionIds = roleSpecificData.customerDetails.preferences.region;
      for (const regionId of regionIds) {
        const region = await Region.findById(regionId);
        if (!region) {
          return errorResponse(res, `Region not found: ${regionId}`, 400);
        }
      }
    }

    // Update user basic info
    const previousEmail = user.email;
    user.name = name;
    user.email = email;
    user.isBotEnable = isBotEnable;
    user.botResponseTime = botResponseTime;
    
    // Don't auto-verify email - user must verify via email link
    // If email is being changed or added for the first time, set verification to false
    if (!previousEmail || previousEmail !== email) {
      user.isEmailVerified = false;
      // Clear any existing verification tokens when email changes
      user.emailVerificationToken = null;
      user.emailVerificationTokenExpiresAt = null;
    }
    // If email hasn't changed, keep the existing verification status
    
    user.status = 'active';
    await user.save();

    // Update existing role-specific details
    console.log('User role:', user.role);
    console.log('Role specific data:', roleSpecificData);
    
    if (user.role === 'broker' && roleSpecificData.brokerDetails) {
      console.log('Updating broker details...');
      const brokerDetail = await BrokerDetail.findOne({ userId: user._id });
      
      if (brokerDetail) {
        // Extract kycDocs, brokerImage, specializations, aboutUs, and content before Object.assign to handle them separately
        const { 
          kycDocs: requestKycDocs, 
          brokerImage: requestBrokerImage,
          specializations: requestSpecializations,
          aboutUs: requestAboutUs,
          content: requestContent,
          ...brokerDetailsWithoutFiles 
        } = roleSpecificData.brokerDetails || {};
        
        // Update existing broker details with user info (excluding special fields)
        Object.assign(brokerDetail, brokerDetailsWithoutFiles);
        brokerDetail.name = name;
        brokerDetail.email = email;
        brokerDetail.phone = phone;

        // Handle specializations explicitly - allow empty array or null
        // Filter out empty strings, null values, and whitespace-only strings
        if (requestSpecializations !== undefined) {
          if (Array.isArray(requestSpecializations)) {
            brokerDetail.specializations = requestSpecializations
              .filter(spec => spec !== null && spec !== undefined && String(spec).trim() !== '');
          } else {
            brokerDetail.specializations = [];
          }
        }

        // Handle languagesSpoken explicitly - allow empty array or null
        const requestLanguagesSpoken = roleSpecificData.brokerDetails?.languagesSpoken;
        if (requestLanguagesSpoken !== undefined) {
          if (Array.isArray(requestLanguagesSpoken)) {
            brokerDetail.languagesSpoken = requestLanguagesSpoken
              .filter(lang => lang !== null && lang !== undefined && String(lang).trim() !== '');
          } else {
            brokerDetail.languagesSpoken = [];
          }
        }

        // Handle serviceType explicitly - allow empty array or null
        const requestServiceType = roleSpecificData.brokerDetails?.serviceType;
        if (requestServiceType !== undefined) {
          if (Array.isArray(requestServiceType)) {
            brokerDetail.serviceType = requestServiceType
              .filter(type => type !== null && type !== undefined && ['Buy', 'Sell', 'Rent'].includes(type));
          } else {
            brokerDetail.serviceType = [];
          }
        }

        // Handle alternateNumber explicitly - allow empty string or null
        const requestAlternateNumber = roleSpecificData.brokerDetails?.alternateNumber;
        if (requestAlternateNumber !== undefined) {
          brokerDetail.alternateNumber = requestAlternateNumber === null || requestAlternateNumber === '' ? null : requestAlternateNumber;
        }

        // Handle aboutUs explicitly - allow empty string or null
        const bd = roleSpecificData.brokerDetails || {};
        if (requestAboutUs !== undefined) {
          brokerDetail.aboutUs = requestAboutUs === null ? null : (requestAboutUs || '');
        } else if (aboutUs !== undefined) {
          brokerDetail.aboutUs = aboutUs === null ? null : (aboutUs || '');
        }

        // Handle content explicitly - allow empty string or null
        if (requestContent !== undefined) {
          brokerDetail.content = requestContent === null ? null : (requestContent || '');
        } else if (content !== undefined) {
          brokerDetail.content = content === null ? null : (content || '');
        }

        // Helper to build address string for geocoding (only use address field)
        const buildFullAddress = (obj) => {
          return obj?.address || '';
        };

        // Always geocode if we have address information (only check address field)
        const hasAddressInfo = !!(roleSpecificData.brokerDetails.address);
        
        if (hasAddressInfo) {
          const fullAddress = buildFullAddress({
            address: brokerDetail.address
          });

          const coords = await geocodeAddress(fullAddress);
          if (coords) {
            brokerDetail.location = {
              type: 'Point',
              coordinates: [coords.lat, coords.lng] // [lat, lng] - index 0=lat, index 1=lng
            };
          }
        }

        // Map optional experience to BrokerDetail (support top-level and nested brokerDetails)
        const finalYears = experienceYears ?? bd.experienceYears;
        if (finalYears !== undefined || bd.experienceDescription || bd.achievements || bd.certifications || experienceDescription || achievements || certifications) {
          brokerDetail.experience = brokerDetail.experience || {};
          if (finalYears !== undefined) brokerDetail.experience.years = finalYears;
          if (experienceDescription || bd.experienceDescription) brokerDetail.experience.description = (experienceDescription || bd.experienceDescription);
          if (Array.isArray(achievements) || Array.isArray(bd.achievements)) brokerDetail.experience.achievements = (achievements || bd.achievements || []);
          if (Array.isArray(certifications) || Array.isArray(bd.certifications)) brokerDetail.experience.certifications = (certifications || bd.certifications || []);
        }

        // Handle file deletions and uploads
        brokerDetail.kycDocs = brokerDetail.kycDocs || {};
        
        // Process uploaded files FIRST (these update/replace existing docs)
        if (files) {
          // Process kycDocs (PDF files) - update existing kycDocs field
          if (files.aadhar) {
            brokerDetail.kycDocs.aadhar = getFileUrl(req, files.aadhar[0].path);
          }
          if (files.aadharFront) {
            brokerDetail.kycDocs.aadharFront = getFileUrl(req, files.aadharFront[0].path);
          }
          if (files.aadharBack) {
            brokerDetail.kycDocs.aadharBack = getFileUrl(req, files.aadharBack[0].path);
          }
          if (files.pan) {
            brokerDetail.kycDocs.pan = getFileUrl(req, files.pan[0].path);
          }
          if (files.panFront) {
            brokerDetail.kycDocs.panFront = getFileUrl(req, files.panFront[0].path);
          }
          if (files.panBack) {
            brokerDetail.kycDocs.panBack = getFileUrl(req, files.panBack[0].path);
          }
          if (files.gst) {
            brokerDetail.kycDocs.gst = getFileUrl(req, files.gst[0].path);
          }
          if (files.brokerLicense) {
            brokerDetail.kycDocs.brokerLicense = getFileUrl(req, files.brokerLicense[0].path);
          }
          if (files.companyId) {
            brokerDetail.kycDocs.companyId = getFileUrl(req, files.companyId[0].path);
          }

          // Process broker image
          if (files.brokerImage) {
            brokerDetail.brokerImage = getFileUrl(req, files.brokerImage[0].path);
          }
        }

        // Process kycDocs deletions AFTER file uploads
        // Handle both nested (brokerDetails.kycDocs) and top-level form fields (aadhar, pan, etc.)
        
        // First, check top-level form fields for deletions (when sent as empty strings)
        const topLevelKycFields = { 
          aadhar, aadharFront, aadharBack, 
          pan, panFront, panBack, 
          gst, brokerLicense, companyId 
        };
        const kycDocFields = ['aadhar', 'aadharFront', 'aadharBack', 'pan', 'panFront', 'panBack', 'gst', 'brokerLicense', 'companyId'];
        
        // Handle remove flags (removePanFront, removePanBack, removeAadharFront, removeAadharBack)
        const removeFlags = {
          panFront: removePanFront === true || removePanFront === 'true',
          panBack: removePanBack === true || removePanBack === 'true',
          aadharFront: removeAadharFront === true || removeAadharFront === 'true',
          aadharBack: removeAadharBack === true || removeAadharBack === 'true'
        };
        
        kycDocFields.forEach(field => {
          // Check if remove flag is set for this field
          const shouldRemove = removeFlags[field] === true;
          
          // Check if top-level field is sent as empty string or null (form field deletion)
          const isEmptyField = topLevelKycFields[field] !== undefined && 
                               (topLevelKycFields[field] === '' || topLevelKycFields[field] === null);
          
          // Delete if remove flag is set OR field is empty/null
          if (shouldRemove || isEmptyField) {
            // Skip deletion if a file was uploaded for this field (file upload takes precedence)
            const hasFileUpload = files && files[field];
            if (!hasFileUpload) {
              brokerDetail.kycDocs[field] = null;
            }
          }
        });
        
        // Then, process nested kycDocs deletions (brokerDetails.kycDocs)
        // Only process if kycDocs is explicitly provided in request body
        if (requestKycDocs !== undefined) {
          // If entire kycDocs object is set to null or empty object, clear ALL docs
          if (requestKycDocs === null || (typeof requestKycDocs === 'object' && Object.keys(requestKycDocs).length === 0 && requestKycDocs.constructor === Object)) {
            brokerDetail.kycDocs = {};
          } else if (typeof requestKycDocs === 'object') {
            // Handle individual KYC doc deletions from nested object
            kycDocFields.forEach(field => {
              // Check if remove flag is set for this field
              const shouldRemove = removeFlags[field] === true;
              
              // Only process if field is explicitly provided in request OR remove flag is set
              if (field in requestKycDocs || shouldRemove) {
                // Skip deletion if a file was uploaded for this field (file upload takes precedence)
                const hasFileUpload = files && files[field];
                if (!hasFileUpload) {
                  // Delete if explicitly set to empty/null/undefined OR remove flag is set
                  if (shouldRemove || requestKycDocs[field] === '' || requestKycDocs[field] === null || requestKycDocs[field] === undefined) {
                    brokerDetail.kycDocs[field] = null;
                  }
                }
              }
            });
          }
        }

        // Handle brokerImage deletion
        // Delete only if explicitly set to empty/null in request body (and no file uploaded)
        if (requestBrokerImage === '' || requestBrokerImage === null) {
          // Only delete if no file was uploaded (file upload takes precedence)
          if (!files || !files.brokerImage) {
            brokerDetail.brokerImage = null;
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
          gender: roleSpecificData.brokerDetails.gender || 'male', // Default to male if not provided
          licenseNumber: roleSpecificData.brokerDetails.licenseNumber || '',
          address: roleSpecificData.brokerDetails.address || '',
          state: roleSpecificData.brokerDetails.state || '',
          city: roleSpecificData.brokerDetails.city || '',
          whatsappNumber: roleSpecificData.brokerDetails.whatsappNumber || '',
          specializations: Array.isArray(roleSpecificData.brokerDetails.specializations) 
            ? roleSpecificData.brokerDetails.specializations.filter(spec => spec !== null && spec !== undefined && String(spec).trim() !== '')
            : [],
          languagesSpoken: Array.isArray(roleSpecificData.brokerDetails.languagesSpoken) 
            ? roleSpecificData.brokerDetails.languagesSpoken.filter(lang => lang !== null && lang !== undefined && String(lang).trim() !== '')
            : [],
          serviceType: Array.isArray(roleSpecificData.brokerDetails.serviceType) 
            ? roleSpecificData.brokerDetails.serviceType.filter(type => type !== null && type !== undefined && ['Buy', 'Sell', 'Rent'].includes(type))
            : [],
          alternateNumber: roleSpecificData.brokerDetails.alternateNumber || null,
          website: roleSpecificData.brokerDetails.website || '',
          socialMedia: {
            linkedin: roleSpecificData.brokerDetails.socialMedia?.linkedin || '',
            twitter: roleSpecificData.brokerDetails.socialMedia?.twitter || '',
            instagram: roleSpecificData.brokerDetails.socialMedia?.instagram || '',
            facebook: roleSpecificData.brokerDetails.socialMedia?.facebook || ''
          },
          ...roleSpecificData.brokerDetails
        });

        // Map optional content/experience on create
        {
          const bd = roleSpecificData.brokerDetails || {};
          const finalContent = content || bd.content || bd.aboutUs || aboutUs;
          if (finalContent) newBrokerDetail.content = finalContent;
          const finalYears = experienceYears ?? bd.experienceYears;
          if (finalYears !== undefined || bd.experienceDescription || bd.achievements || bd.certifications || experienceDescription || achievements || certifications) {
            newBrokerDetail.experience = newBrokerDetail.experience || {};
            if (finalYears !== undefined) newBrokerDetail.experience.years = finalYears;
            if (experienceDescription || bd.experienceDescription) newBrokerDetail.experience.description = (experienceDescription || bd.experienceDescription);
            if (Array.isArray(achievements) || Array.isArray(bd.achievements)) newBrokerDetail.experience.achievements = (achievements || bd.achievements || []);
            if (Array.isArray(certifications) || Array.isArray(bd.certifications)) newBrokerDetail.experience.certifications = (certifications || bd.certifications || []);
          }
        }

        // Geocode on create if we have address
        const fullAddress = roleSpecificData.brokerDetails.address || '';
        
        if (fullAddress) {
          const coords = await geocodeAddress(fullAddress);
          if (coords) {
        newBrokerDetail.location = {
          type: 'Point',
          coordinates: [coords.lat, coords.lng] // [lat, lng] - index 0=lat, index 1=lng
        };
          }
        }

        // Process uploaded files if any
        if (files) {
          // Initialize kycDocs object if it doesn't exist
          newBrokerDetail.kycDocs = newBrokerDetail.kycDocs || {};
          
          // Process kycDocs (PDF files) - update existing kycDocs field
          if (files.aadhar) {
            newBrokerDetail.kycDocs.aadhar = getFileUrl(req, files.aadhar[0].path);
          }
          if (files.aadharFront) {
            newBrokerDetail.kycDocs.aadharFront = getFileUrl(req, files.aadharFront[0].path);
          }
          if (files.aadharBack) {
            newBrokerDetail.kycDocs.aadharBack = getFileUrl(req, files.aadharBack[0].path);
          }
          if (files.pan) {
            newBrokerDetail.kycDocs.pan = getFileUrl(req, files.pan[0].path);
          }
          if (files.panFront) {
            newBrokerDetail.kycDocs.panFront = getFileUrl(req, files.panFront[0].path);
          }
          if (files.panBack) {
            newBrokerDetail.kycDocs.panBack = getFileUrl(req, files.panBack[0].path);
          }
          if (files.gst) {
            newBrokerDetail.kycDocs.gst = getFileUrl(req, files.gst[0].path);
          }
          if (files.brokerLicense) {
            newBrokerDetail.kycDocs.brokerLicense = getFileUrl(req, files.brokerLicense[0].path);
          }
          if (files.companyId) {
            newBrokerDetail.kycDocs.companyId = getFileUrl(req, files.companyId[0].path);
          }

          // Process broker image
          if (files.brokerImage) {
            newBrokerDetail.brokerImage = getFileUrl(req, files.brokerImage[0].path);
          }
        }

        await newBrokerDetail.save();
        console.log('Broker details created successfully');
        
        // Update broker count for assigned regions
        if (newBrokerDetail.region && newBrokerDetail.region.length > 0) {
          await updateMultipleRegionBrokerCounts(newBrokerDetail.region);
        }
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

        // Handle customerImage deletion (if explicitly set to empty/null in request body)
        const cdImages = roleSpecificData.customerDetails?.images;
        if (cdImages?.customerImage === '' || cdImages?.customerImage === null) {
          customerDetail.images = customerDetail.images || {};
          customerDetail.images.customerImage = null;
        }

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
          gender: roleSpecificData.customerDetails.gender || 'male', // Default to male if not provided
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
        status: user.status,
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified
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

        // Include geocoded coordinates in response
        if (brokerDetail.location?.coordinates?.length === 2) {
          const [lat, lng] = brokerDetail.location.coordinates; // [lat, lng] format
          responseData.location = { lat, lng };
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
    const platform = req.platform || 'web'; // Default to web if not specified

    // Check if there's existing temporary OTP data
    const existingTempData = tempOTPStorage.get(phone);
    
    let userRole, userId, isNewUser = false;

    if (existingTempData) {
      // Use existing data
      userRole = existingTempData.role;
      userId = existingTempData.userId;
      isNewUser = existingTempData.userId === null;
    } else {
      // No existing OTP data - find user or prepare for new user
      const user = await User.findOne({ phone });
      
      if (user) {
        // User exists
        userRole = user.role;
        userId = user._id;
        isNewUser = false;
        
        // Check platform restrictions
        if (platform === 'android' && user.role !== 'broker') {
          return errorResponse(res, 'Invalid user role for Android login', 400);
        }
        if (platform === 'web' && !['broker', 'customer'].includes(user.role)) {
          return errorResponse(res, 'Invalid user role for web login', 400);
        }
      } else {
        // User doesn't exist - handle based on platform
        if (platform === 'android') {
          // Android: Allow new broker registration
          userRole = 'broker';
          userId = null;
          isNewUser = true;
        } else {
          // Web: Don't auto-create, require registration first
          return errorResponse(res, 'User not found. Please register first.', 404, {
            redirectToRegister: true,
            message: 'This number is not registered. Please go to the registration page to create an account.'
          });
        }
      }
    }

    // Generate new OTP
    const otp = generateOTP();
    
    // Store/update OTP data
    tempOTPStorage.set(phone, {
      otp: otp,
      role: userRole,
      platform: platform,
      type: 'login',
      userId: userId,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    });

    // TODO: Send OTP via SMS
    console.log(`Resend OTP for ${phone}: ${otp}`);

    return successResponse(res, 'OTP sent successfully', {
      phone: phone,
      role: userRole,
      platform: platform,
      type: 'login',
      isNewUser: isNewUser,
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
      additionalDetails = await BrokerDetail.findOne({ userId: user._id }).populate('region', 'name description city state centerLocation radius').lean();
      const brokerSubscription = await Subscription.findOne({ user: new mongoose.Types.ObjectId(user._id), endDate: { $gt: new Date() } }).lean();
      
      if (additionalDetails) {
        additionalDetails.subscription = brokerSubscription || null;
      }
    } else if (user.role === 'customer') {
      additionalDetails = await CustomerDetail.findOne({ userId: user._id }).populate('preferences.region', 'name description').lean();
    }

    return successResponse(res, 'Profile retrieved successfully', {
      user,
      additionalDetails
    });

  } catch (error) {
    return serverError(res, error);
  }
};

// Check if email exists
export const checkEmailExists = async (req, res) => {
  try {
    const { email, userId } = req.query;

    if (!email) {
      return errorResponse(res, 'Email parameter is required', 400);
    }

    // Build query to exclude current user if userId is provided
    let query = { email: email.toLowerCase() };
    if (userId) {
      query._id = { $ne: userId };
    }

    // Check if email exists in database (excluding current user)
    const existingUser = await User.findOne(query);

    return successResponse(res, 'Email check completed', {
      email: email,
      exists: !!existingUser,
      message: existingUser ? 'Email is already in use by another account' : 'Email is available'
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
        status: user.status,
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified
      }
    });

  } catch (error) {
    return serverError(res, error);
  }
};

// createAdmin Broker
export const adminCreateBroker = async (req, res) => {
  try {
    // allow only admin
    if (!req.user || req.user.role !== 'admin') {
      return errorResponse(res, 'Admin access required', 403);
    }


      const { phone ,email,name, image, profileImage, } = req.body;

    // uniqueness checks
    const byPhone = await User.findOne({ phone });
    if (byPhone) return errorResponse(res, `Phone ${phone} is already registered as ${byPhone.role}.`, 409);

    const byEmail = await User.findOne({ email: email.toLowerCase() });
    if (byEmail) return errorResponse(res, `Email ${email} is already registered as ${byEmail.role}.`, 409);
    
     const DEFAULT_BROKER_AVATAR =
      'https://www.vhv.rs/dpng/d/312-3120300_default-profile-hd-png-download.png';

    const finalProfileImage =
      (typeof image === 'string' && image.trim()) ||
      (typeof profileImage === 'string' && profileImage.trim()) ||
      DEFAULT_BROKER_AVATAR;
    // create user (broker)
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      phone,
      role: 'broker',
      status: 'active',
      isPhoneVerified: true,      // OTP bypass
      isEmailVerified: false,
      platform: 'admin-panel',
      createdBy: req.user._id,
      source: 'admin_create',
       profileImage: finalProfileImage, 
    });

    // (optional) If your BrokerDetail model has ONLY these 3-4 fields, keep it minimal
    const brokerDetail = await BrokerDetail.create({
      userId: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      brokerImage: finalProfileImage,
    });

    // Create notifications for broker creation (non-blocking - fire and forget)
    // Notification to broker
    createNotification({
      userId: user._id,
      type: 'approval',
      title: ' Broker Account Created',
      message: `Welcome to Brokergully! Your broker account has been successfully created.\n\n` +
        `Account Details:\n\n` +
        `Name: ${user.name || 'N/A'}\n\n` +
        `Email: ${user.email}\n\n` +
        `Phone: ${user.phone}\n\n` +
        `Created By: Admin${req.user?.name ? ` (${req.user.name})` : ''}\n\n` +
        ` Note: Your account is now active. You can start listing properties and managing inquiries.`,
      priority: 'high',
      relatedEntity: {
        entityType: 'BrokerDetail',
        entityId: brokerDetail._id
      },
      activity: {
        action: 'created',
        actorId: req.user?._id || null,
        actorName: req.user?.name || 'Admin'
      },
      metadata: {
        brokerId: brokerDetail._id,
        status: 'active',
        createdBy: 'admin'
      }
    }).catch(notifError => {
      console.error('Error creating broker creation notification to broker:', notifError);
    });

    // Notification to admin who created the broker
    if (req.user?._id) {
      createNotification({
        userId: req.user._id,
        type: 'approval',
        title: ' Broker Account Created Successfully',
        message: `You have successfully created a new broker account in the Brokergully Command Center.\n\n` +
          `Broker Details:\n\n` +
          `Name: ${user.name || 'N/A'}\n\n` +
          `Email: ${user.email}\n\n` +
          `Phone: ${user.phone}\n\n` +
          `Status: Active\n\n` +
          ` Note: The broker can now access their account and start using the platform.`,
        priority: 'medium',
        relatedEntity: {
          entityType: 'BrokerDetail',
          entityId: brokerDetail._id
        },
        activity: {
          action: 'brokerCreated',
          actorId: req.user._id,
          actorName: req.user?.name || 'Admin'
        },
        metadata: {
          brokerId: brokerDetail._id,
          brokerName: user.name,
          brokerPhone: user.phone,
          brokerEmail: user.email
        }
      }).catch(notifError => {
        console.error('Error creating broker creation notification to admin:', notifError);
      });
    }

    // Notify all other admin users (excluding the one who created)
    User.find({ role: 'admin', _id: { $ne: req.user?._id } })
      .select('_id name email')
      .then(admins => {
        admins.forEach(admin => {
          createNotification({
            userId: admin._id,
            type: 'approval',
            title: ' New Broker Created by Admin',
            message: `A new broker account has been created in the Brokergully Command Center.\n\n` +
              `Broker Details:\n\n` +
              `Name: ${user.name || 'N/A'}\n\n` +
              `Email: ${user.email}\n\n` +
              `Phone: ${user.phone}\n\n` +
              `Created By: ${req.user?.name || 'Admin'}\n\n` +
              ` Note: This broker account is now active and ready to use.`,
            priority: 'low',
            relatedEntity: {
              entityType: 'BrokerDetail',
              entityId: brokerDetail._id
            },
            activity: {
              action: 'brokerCreated',
              actorId: req.user?._id || null,
              actorName: req.user?.name || 'Admin'
            },
            metadata: {
              brokerId: brokerDetail._id,
              brokerName: user.name,
              brokerPhone: user.phone,
              brokerEmail: user.email
            }
          }).catch(notifError => {
            console.error(`Error creating broker creation notification to admin ${admin._id}:`, notifError);
          });
        });
      })
      .catch(error => {
        console.error('Error fetching admin users for broker creation notification:', error);
      });

    return successResponse(
      res,
      'Broker created successfully (by admin, no OTP).',
      {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
          isPhoneVerified: user.isPhoneVerified,
            profileImage: finalProfileImage,
        }
      },
      201
    );
  } catch (err) {
    if (err.isJoi) {
      const msg = err.details?.map(d => d.message).join(', ') || err.message;
      return errorResponse(res, msg, 400);
    }
    return serverError(res, err);
  }
};

// Delete account
export const deleteAccount = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);
    
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    // Prevent admin account deletion
    if (user.role === 'admin') {
      return errorResponse(res, 'Admin accounts cannot be deleted', 403);
    }

    // Delete role-specific details
    if (user.role === 'broker') {
      const brokerDetail = await BrokerDetail.findOne({ userId });
      if (brokerDetail) {
        // Update region broker counts before deleting broker
        if (brokerDetail.region && brokerDetail.region.length > 0) {
          // Decrement broker count for each region
          for (const regionId of brokerDetail.region) {
            await Region.findByIdAndUpdate(regionId, { $inc: { brokerCount: -1 } });
          }
        }
        
        // Delete all properties owned by this broker
        await Property.deleteMany({ broker: brokerDetail._id });
        
        // Delete leads created by this broker (admin-created leads are excluded automatically
        // since their createdBy is an admin user ID, not a broker ID)
        await Lead.deleteMany({ createdBy: brokerDetail._id });
        
        // Delete leads where this broker appears in transfers (fromBroker or toBroker)
        // Exclude admin-created leads - get admin user IDs first
        const adminUsers = await User.find({ role: 'admin' }).select('_id').lean();
        const adminUserIds = adminUsers.map(u => u._id);
        
        // Delete leads with transfers involving this broker, but exclude admin-created leads
        await Lead.deleteMany({
          $and: [
            {
              $or: [
                { 'transfers.fromBroker': brokerDetail._id },
                { 'transfers.toBroker': brokerDetail._id }
              ]
            },
            {
              createdBy: { $nin: adminUserIds }
            }
          ]
        });
        
        // Delete broker ratings (ratings given to this broker)
        await BrokerRating.deleteMany({ brokerId: brokerDetail._id });
        
        // Delete broker detail
        await BrokerDetail.findByIdAndDelete(brokerDetail._id);
      }
    } else if (user.role === 'customer') {
      const customerDetail = await CustomerDetail.findOne({ userId });
      if (customerDetail) {
        // Delete customer detail
        await CustomerDetail.findByIdAndDelete(customerDetail._id);
      }
    }

    // Delete user-related data
    await SavedProperty.deleteMany({ userId });
    await Notification.deleteMany({ userId });
    await PropertyRating.deleteMany({ userId });
    await BrokerRating.deleteMany({ userId }); // Ratings given by this user
    await Payment.deleteMany({ user: userId });
    await Subscription.deleteMany({ user: userId });

    // Handle chats and messages
    // Find all chats where user is a participant
    const userChats = await Chat.find({ participants: userId });
    
    for (const chat of userChats) {
      // If chat has only one participant (this user), delete the entire chat
      if (chat.participants.length === 1) {
        await Message.deleteMany({ chatId: chat._id });
        await Chat.findByIdAndDelete(chat._id);
      } else {
        // Remove user from participants and update unreadCounts
        chat.participants = chat.participants.filter(
          p => p.toString() !== userId.toString()
        );
        chat.unreadCounts?.delete(userId.toString());
        await chat.save();
        
        // Mark messages as deleted for this user
        await Message.updateMany(
          { chatId: chat._id },
          { $addToSet: { isDeletedFor: userId } }
        );
      }
    }

    // Delete messages sent by this user (if chat still exists)
    await Message.updateMany(
      { from: userId },
      { $set: { text: '[Message deleted]', attachments: [] } }
    );

    // Finally, delete the user
    await User.findByIdAndDelete(userId);

    return successResponse(res, 'Account deleted successfully', {
      message: 'Your account and all associated data have been permanently deleted'
    });

  } catch (error) {
    return serverError(res, error);
  }
};

// Send email verification
export const sendEmailVerification = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    
    if (!userId) {
      return errorResponse(res, 'Authentication required', 401);
    }

    const user = await User.findById(userId);
    
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    if (!user.email) {
      return errorResponse(res, 'Email address not found. Please add an email address to your profile first.', 400);
    }

    // Allow resending verification email even if already verified
    // This allows users to verify again if they changed their email or want to resend
    // Generate new verification token
    const verificationToken = generateEmailVerificationToken();
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Save token to user
    user.emailVerificationToken = verificationToken;
    user.emailVerificationTokenExpiresAt = tokenExpiresAt;
    await user.save();

    // Send verification email (non-blocking - fire and forget)
    // Don't await - let it run in background so response is sent immediately
    sendVerificationEmail(
      user.email,
      verificationToken,
      user.name || 'User'
    ).then(emailSent => {
      if (!emailSent) {
        console.error('Failed to send verification email. SMTP may not be configured properly.');
      } else {
        console.log(`Verification email sent successfully to ${user.email}`);
      }
    }).catch(error => {
      console.error('Error sending verification email:', error);
      // Don't fail the request - token is already saved, user can request again if needed
    });

    // Send response immediately (email sending runs in background)
    return successResponse(res, 'Verification email sent successfully', {
      message: 'Please check your email inbox and click on the verification link.',
      email: user.email,
      isEmailVerified: user.isEmailVerified
    });

  } catch (error) {
    return serverError(res, error);
  }
};

// Verify email with token
export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return errorResponse(res, 'Verification token is required', 400);
    }

    // Find user with this token
    const user = await User.findOne({
      emailVerificationToken: token
    });

    if (!user) {
      return errorResponse(res, 'Invalid or expired verification token', 400);
    }

    // Check if token expired
    if (user.emailVerificationTokenExpiresAt && user.emailVerificationTokenExpiresAt < new Date()) {
      // Clear expired token
      user.emailVerificationToken = null;
      user.emailVerificationTokenExpiresAt = null;
      await user.save();
      
      return errorResponse(res, 'Verification token has expired. Please request a new verification email.', 400);
    }

    // Verify email
    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationTokenExpiresAt = null;
    await user.save();

    // Create notification for email verification (non-blocking - fire and forget)
    createNotification({
      userId: user._id,
      type: 'system',
      title: ' Email Verified Successfully',
      message: `Your email address has been successfully verified in the Brokergully Command Center.\n\n` +
        `Email: ${user.email}\n\n` +
        `Status: Verified\n\n` +
        `Note: Your account is now fully activated. You can access all features of the platform.`,
      priority: 'medium',
      relatedEntity: {
        entityType: 'User',
        entityId: user._id
      },
      activity: {
        action: 'emailVerified',
        actorId: user._id,
        actorName: user.name || 'User'
      },
      metadata: {
        email: user.email,
        verifiedAt: new Date()
      }
    }).catch(notifError => {
      console.error('Error creating email verification notification:', notifError);
      // Don't fail the request if notification fails
    });

    return successResponse(res, 'Email verified successfully', {
      message: 'Your email has been verified successfully.',
      user: {
        id: user._id,
        email: user.email,
        isEmailVerified: user.isEmailVerified
      }
    });

  } catch (error) {
    return serverError(res, error);
  }
};
