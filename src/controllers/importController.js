import User from '../models/User.js';
import BrokerDetail from '../models/BrokerDetail.js';
import Property from '../models/Property.js';
import Lead from '../models/Lead.js';
import Region from '../models/Region.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { geocodeAddress } from '../utils/geocode.js';
import csv from 'csv-parser';
import fs from 'fs';
import { Readable } from 'stream';

/**
 * Import brokers from CSV file
 * Maps CSV columns to User and BrokerDetail models
 */
export const importBrokersFromCSV = async (req, res) => {
  try {
    if (!req.file) {
      return errorResponse(res, 'Please upload a CSV file', 400);
    }

    const results = [];
    const errors = [];
    let rowNumber = 1; // Start from 1 (excluding header)

    // Parse CSV file
    const stream = Readable.from(req.file.buffer.toString());
    
    stream
      .pipe(csv())
      .on('data', (data) => results.push({ ...data, rowNumber: ++rowNumber }))
      .on('end', async () => {
        try {
          const importedBrokers = [];
          const failedRows = [];

          for (const row of results) {
            try {
              // Clean and prepare data
              const cleanedRow = cleanRowData(row);
              
              // Validate required fields
              if (!cleanedRow.fullName || !cleanedRow.phone) {
                failedRows.push({
                  row: row.rowNumber,
                  data: row,
                  error: 'Missing required fields: Full Name and Phone are required'
                });
                continue;
              }

              // Check if user already exists
              let user = await User.findOne({ phone: cleanedRow.phone });
              
              if (user) {
                failedRows.push({
                  row: row.rowNumber,
                  data: row,
                  error: `User with phone ${cleanedRow.phone} already exists`
                });
                continue;
              }

              // Find or create region
              let regionId = null;
              if (cleanedRow.region) {
                let region = await Region.findOne({ 
                  name: { $regex: new RegExp(`^${cleanedRow.region}$`, 'i') }
                });
                
                if (!region) {
                  // Create new region if it doesn't exist
                  region = await Region.create({
                    name: cleanedRow.region,
                    city: cleanedRow.city || 'Agra',
                    state: cleanedRow.state || 'Uttar Pradesh',
                    status: 'active'
                  });
                }
                regionId = region._id;
              }

              // Create User
              user = await User.create({
                name: cleanedRow.fullName,
                email: cleanedRow.email || undefined,
                phone: cleanedRow.phone,
                role: 'broker',
                status: 'active',
                isPhoneVerified: true
              });

              // Parse specializations
              const specializations = parseArrayField(cleanedRow.specializations);
              
              // Parse languages spoken
              const languagesSpoken = parseArrayField(cleanedRow.languagesSpoken);
              
              // Parse service types
              const serviceType = parseServiceTypes(cleanedRow.serviceType);

              // Build kycDocs object (only include fields with values)
              const kycDocs = {};
              if (cleanedRow.aadharCard) kycDocs.aadhar = cleanedRow.aadharCard;
              if (cleanedRow.aadharFront) kycDocs.aadharFront = cleanedRow.aadharFront;
              if (cleanedRow.aadharBack) kycDocs.aadharBack = cleanedRow.aadharBack;
              if (cleanedRow.panCard) kycDocs.pan = cleanedRow.panCard;
              if (cleanedRow.panFront) kycDocs.panFront = cleanedRow.panFront;
              if (cleanedRow.panBack) kycDocs.panBack = cleanedRow.panBack;
              if (cleanedRow.gstCertificate) kycDocs.gst = cleanedRow.gstCertificate;
              if (cleanedRow.brokerLicense) kycDocs.brokerLicense = cleanedRow.brokerLicense;
              if (cleanedRow.companyId) kycDocs.companyId = cleanedRow.companyId;

              // Debug: Log what we're saving for KYC docs
              console.log(`📄 KYC Docs for ${cleanedRow.fullName}:`, kycDocs);

              // Geocode address to get coordinates for broker location
              let brokerLocation = undefined;
              if (cleanedRow.address) {
                try {
                  console.log(`Geocoding address for ${cleanedRow.fullName}: ${cleanedRow.address}`);
                  const coords = await geocodeAddress(cleanedRow.address);
                  if (coords && coords.lat && coords.lng) {
                    brokerLocation = {
                      type: 'Point',
                      coordinates: [coords.lat, coords.lng] // [lat, lng]
                    };
                    console.log(`✅ Geocoded successfully: [${coords.lat}, ${coords.lng}]`);
                  } else {
                    console.log(`⚠️ Geocoding returned no coordinates for: ${cleanedRow.address}`);
                  }
                } catch (geocodeError) {
                  console.error(`❌ Error geocoding broker address for ${cleanedRow.fullName}:`, geocodeError.message);
                  // Continue without coordinates if geocoding fails
                }
              }

              // Create BrokerDetail
              const brokerDetail = await BrokerDetail.create({
                userId: user._id,
                name: cleanedRow.fullName,
                email: cleanedRow.email || undefined,
                phone: cleanedRow.phone,
                whatsappNumber: cleanedRow.whatsappNumber || cleanedRow.phone,
                gender: cleanedRow.gender ? cleanedRow.gender.toLowerCase() : undefined,
                firmName: cleanedRow.firmName,
                licenseNumber: cleanedRow.licenseNumber,
                address: cleanedRow.address,
                location: brokerLocation,
                state: cleanedRow.state,
                city: cleanedRow.city,
                specializations: specializations,
                website: cleanedRow.website,
                socialMedia: {
                  linkedin: cleanedRow.linkedin,
                  twitter: cleanedRow.twitter,
                  instagram: cleanedRow.instagram,
                  facebook: cleanedRow.facebook
                },
                region: regionId ? [regionId] : [],
                kycDocs: kycDocs,
                brokerImage: cleanedRow.brokerImage || cleanedRow.image,
                role: 'broker',
                content: cleanedRow.about,
                experience: {
                  years: cleanedRow.experienceYears ? parseInt(cleanedRow.experienceYears) : undefined
                },
                languagesSpoken: languagesSpoken,
                serviceType: serviceType,
                alternateNumber: cleanedRow.alternatePhone,
                rating: 4, // Default rating
                verificationStatus: 'Verified',
                status: 'active',
                approvedByAdmin: 'unblocked'
              });

              importedBrokers.push({
                row: row.rowNumber,
                userId: user._id,
                brokerDetailId: brokerDetail._id,
                name: cleanedRow.fullName,
                phone: cleanedRow.phone
              });

            } catch (error) {
              console.error(`Error processing row ${row.rowNumber}:`, error);
              failedRows.push({
                row: row.rowNumber,
                data: row,
                error: error.message
              });
            }
          }

          // Return summary
          return successResponse(res, {
            message: 'CSV import completed',
            summary: {
              totalRows: results.length,
              successfulImports: importedBrokers.length,
              failedImports: failedRows.length
            },
            importedBrokers,
            failedRows
          }, 200);

        } catch (error) {
          console.error('Error processing CSV:', error);
          return errorResponse(res, 'Error processing CSV file', 500);
        }
      })
      .on('error', (error) => {
        console.error('Error reading CSV:', error);
        return errorResponse(res, 'Error reading CSV file', 500);
      });

  } catch (error) {
    console.error('Import error:', error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Clean and normalize row data from CSV
 */
const cleanRowData = (row) => {
  // Map CSV column names to our field names (case-insensitive)
  const fieldMapping = {
    'full name': 'fullName',
    'fullname': 'fullName',
    'name': 'fullName',
    'gender': 'gender',
    'firm name': 'firmName',
    'firmname': 'firmName',
    'email': 'email',
    'phone': 'phone',
    'whatsapp number': 'whatsappNumber',
    'whatsappnumber': 'whatsappNumber',
    'alternate phone': 'alternatePhone',
    'alternatephone': 'alternatePhone',
    'alternate_phone': 'alternatePhone',
    'rera license number': 'licenseNumber',
    'license number': 'licenseNumber',
    'licensenumber': 'licenseNumber',
    'experience (years)': 'experienceYears',
    'experience': 'experienceYears',
    'languages spoken': 'languagesSpoken',
    'languages': 'languagesSpoken',
    'service type': 'serviceType',
    'servicetype': 'serviceType',
    'address': 'address',
    'about': 'about',
    'specializations': 'specializations',
    'broker image': 'brokerImage',
    'brokerimage': 'brokerImage',
    'profile image': 'brokerImage',
    'profileimage': 'brokerImage',
    'image': 'brokerImage',
    'linkedin': 'linkedin',
    'twitter': 'twitter',
    'instagram': 'instagram',
    'facebook': 'facebook',
    'website': 'website',
    'region': 'region',
    'city': 'city',
    'state': 'state',
    'aadhar card': 'aadharCard',
    'aadharcard': 'aadharCard',
    'aadhar': 'aadharCard',
    'aadhar front': 'aadharFront',
    'aadharfront': 'aadharFront',
    'aadhar card front': 'aadharFront',
    'aadhar back': 'aadharBack',
    'aadharback': 'aadharBack',
    'aadhar card back': 'aadharBack',
    'pan card': 'panCard',
    'pancard': 'panCard',
    'pan': 'panCard',
    'pan front': 'panFront',
    'panfront': 'panFront',
    'pan card front': 'panFront',
    'pan back': 'panBack',
    'panback': 'panBack',
    'pan card back': 'panBack',
    'gst certificate': 'gstCertificate',
    'gstcertificate': 'gstCertificate',
    'gst': 'gstCertificate',
    'broker license company identification': 'brokerLicense',
    'broker license': 'brokerLicense',
    'brokerlicense': 'brokerLicense',
    'license': 'brokerLicense',
    'company id': 'companyId',
    'companyid': 'companyId',
    'company identification': 'companyId',
    'company identification details': 'companyId',
    'companyidentificationdetails': 'companyId'
  };

  const cleaned = {};
  
  for (const [key, value] of Object.entries(row)) {
    if (key === 'rowNumber') {
      cleaned.rowNumber = value;
      continue;
    }
    
    const normalizedKey = key.toLowerCase().trim();
    const mappedKey = fieldMapping[normalizedKey] || key;
    
    // Clean the value - trim and handle empty strings
    const cleanedValue = typeof value === 'string' ? value.trim() : value;
    cleaned[mappedKey] = cleanedValue === '' ? undefined : cleanedValue;
  }

  return cleaned;
};

/**
 * Parse comma-separated field into array
 */
const parseArrayField = (field) => {
  if (!field) return [];
  if (Array.isArray(field)) return field;
  
  return field
    .split(',')
    .map(item => item.trim())
    .filter(item => item !== '');
};

/**
 * Parse and validate service types
 */
const parseServiceTypes = (field) => {
  if (!field) return [];
  
  const types = parseArrayField(field);
  const validTypes = ['Buy', 'Sell', 'Rent'];
  
  return types
    .map(type => {
      // Capitalize first letter
      const formatted = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
      return validTypes.includes(formatted) ? formatted : null;
    })
    .filter(type => type !== null);
};

/**
 * Import properties from CSV file
 */
export const importPropertiesFromCSV = async (req, res) => {
  try {
    if (!req.file) {
      return errorResponse(res, 'Please upload a CSV file', 400);
    }

    const results = [];
    let rowNumber = 1;

    const stream = Readable.from(req.file.buffer.toString());
    
    stream
      .pipe(csv())
      .on('data', (data) => results.push({ ...data, rowNumber: ++rowNumber }))
      .on('end', async () => {
        try {
          const importedProperties = [];
          const failedRows = [];

          for (const row of results) {
            try {
              const cleanedRow = cleanPropertyRowData(row);
              
              // Validate required fields
              if (!cleanedRow.title || !cleanedRow.price || !cleanedRow.address || !cleanedRow.propertyType) {
                failedRows.push({
                  row: row.rowNumber,
                  data: row,
                  error: 'Missing required fields: Title, Price, Address, and Property Type are required'
                });
                continue;
              }

              // Find or create region
              let regionId = null;
              if (cleanedRow.region) {
                let region = await Region.findOne({ 
                  name: { $regex: new RegExp(`^${cleanedRow.region}$`, 'i') }
                });
                
                if (!region) {
                  region = await Region.create({
                    name: cleanedRow.region,
                    city: cleanedRow.city || 'Agra',
                    state: cleanedRow.state || 'Uttar Pradesh',
                    status: 'active'
                  });
                }
                regionId = region._id;
              } else {
                failedRows.push({
                  row: row.rowNumber,
                  data: row,
                  error: 'Region is required'
                });
                continue;
              }

              // Find broker by phone or email
              let broker = null;
              if (cleanedRow.brokerPhone) {
                const user = await User.findOne({ phone: cleanedRow.brokerPhone, role: 'broker' });
                if (user) {
                  broker = await BrokerDetail.findOne({ userId: user._id });
                }
              }

              if (!broker) {
                failedRows.push({
                  row: row.rowNumber,
                  data: row,
                  error: 'Broker not found with provided phone number'
                });
                continue;
              }

              // Parse arrays
              const amenities = parseArrayField(cleanedRow.amenities);
              const nearbyAmenities = parseArrayField(cleanedRow.nearbyAmenities);
              const features = parseArrayField(cleanedRow.features);
              const locationBenefits = parseArrayField(cleanedRow.locationBenefits);
              const images = parseArrayField(cleanedRow.images);
              const videos = parseArrayField(cleanedRow.videos);

              // Parse hot property boolean
              const isHotProperty = cleanedRow.isHotProperty === 'TRUE' || 
                                   cleanedRow.isHotProperty === 'true' || 
                                   cleanedRow.isHotProperty === 'yes' || 
                                   cleanedRow.isHotProperty === 'Yes' ||
                                   cleanedRow.isHotProperty === '1';

              // Geocode address to get coordinates for property
              let latitude = null;
              let longitude = null;
              if (cleanedRow.address) {
                try {
                  // Build full address string for geocoding
                  const fullAddress = [cleanedRow.address, cleanedRow.city].filter(Boolean).join(', ');
                  console.log(`Geocoding property address: ${fullAddress}`);
                  const coords = await geocodeAddress(fullAddress);
                  if (coords && coords.lat && coords.lng) {
                    latitude = coords.lat;
                    longitude = coords.lng;
                    console.log(`✅ Property geocoded successfully: [${coords.lat}, ${coords.lng}]`);
                  } else {
                    console.log(`⚠️ Geocoding returned no coordinates for property: ${fullAddress}`);
                  }
                } catch (geocodeError) {
                  console.error(`❌ Error geocoding property address: ${fullAddress}`, geocodeError.message);
                  // Continue without coordinates if geocoding fails
                }
              }

              // Create Property
              const property = await Property.create({
                title: cleanedRow.title,
                description: cleanedRow.description,
                propertyDescription: cleanedRow.propertyDescription,
                propertyType: cleanedRow.propertyType,
                subType: cleanedRow.subType,
                price: parseFloat(cleanedRow.price),
                priceUnit: cleanedRow.priceUnit || 'INR',
                propertySize: cleanedRow.propertySize ? parseFloat(cleanedRow.propertySize) : undefined,
                address: cleanedRow.address,
                city: cleanedRow.city || 'Agra',
                region: regionId,
                latitude: latitude,
                longitude: longitude,
                isHotProperty: isHotProperty,
                bedrooms: cleanedRow.bedrooms ? parseInt(cleanedRow.bedrooms) : undefined,
                bathrooms: cleanedRow.bathrooms ? parseInt(cleanedRow.bathrooms) : undefined,
                furnishing: cleanedRow.furnishing,
                amenities: amenities,
                nearbyAmenities: nearbyAmenities,
                features: features,
                locationBenefits: locationBenefits,
                images: images,
                videos: videos,
                broker: broker._id,
                facingDirection: cleanedRow.facingDirection,
                possessionStatus: cleanedRow.possessionStatus,
                postedBy: 'Admin',
                createdBy: 'broker',
                verificationStatus: 'Verified',
                propertyAgeYears: cleanedRow.propertyAgeYears ? parseInt(cleanedRow.propertyAgeYears) : undefined,
                status: 'Active',
                notes: cleanedRow.notes
              });

              importedProperties.push({
                row: row.rowNumber,
                propertyId: property._id,
                title: cleanedRow.title,
                price: cleanedRow.price
              });

            } catch (error) {
              console.error(`Error processing row ${row.rowNumber}:`, error);
              failedRows.push({
                row: row.rowNumber,
                data: row,
                error: error.message
              });
            }
          }

          return successResponse(res, {
            message: 'CSV import completed',
            summary: {
              totalRows: results.length,
              successfulImports: importedProperties.length,
              failedImports: failedRows.length
            },
            importedProperties,
            failedRows
          }, 200);

        } catch (error) {
          console.error('Error processing CSV:', error);
          return errorResponse(res, 'Error processing CSV file', 500);
        }
      })
      .on('error', (error) => {
        console.error('Error reading CSV:', error);
        return errorResponse(res, 'Error reading CSV file', 500);
      });

  } catch (error) {
    console.error('Import error:', error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Import leads from CSV file
 */
export const importLeadsFromCSV = async (req, res) => {
  try {
    if (!req.file) {
      return errorResponse(res, 'Please upload a CSV file', 400);
    }

    const results = [];
    let rowNumber = 1;

    const stream = Readable.from(req.file.buffer.toString());
    
    stream
      .pipe(csv())
      .on('data', (data) => results.push({ ...data, rowNumber: ++rowNumber }))
      .on('end', async () => {
        try {
          const importedLeads = [];
          const failedRows = [];

          for (const row of results) {
            try {
              const cleanedRow = cleanLeadRowData(row);
              
              // Validate required fields
              if (!cleanedRow.customerName || !cleanedRow.customerPhone || !cleanedRow.requirement || !cleanedRow.propertyType) {
                failedRows.push({
                  row: row.rowNumber,
                  data: row,
                  error: 'Missing required fields: Customer Name, Phone, Requirement, and Property Type are required'
                });
                continue;
              }

              // Find primary region
              let primaryRegionId = null;
              if (cleanedRow.primaryRegion) {
                let region = await Region.findOne({ 
                  name: { $regex: new RegExp(`^${cleanedRow.primaryRegion}$`, 'i') }
                });
                
                if (!region) {
                  region = await Region.create({
                    name: cleanedRow.primaryRegion,
                    city: 'Agra',
                    state: 'Uttar Pradesh',
                    status: 'active'
                  });
                }
                primaryRegionId = region._id;
              } else {
                failedRows.push({
                  row: row.rowNumber,
                  data: row,
                  error: 'Primary Region is required'
                });
                continue;
              }

              // Find secondary region (optional)
              let secondaryRegionId = null;
              if (cleanedRow.secondaryRegion) {
                let region = await Region.findOne({ 
                  name: { $regex: new RegExp(`^${cleanedRow.secondaryRegion}$`, 'i') }
                });
                
                if (!region) {
                  region = await Region.create({
                    name: cleanedRow.secondaryRegion,
                    city: 'Agra',
                    state: 'Uttar Pradesh',
                    status: 'active'
                  });
                }
                secondaryRegionId = region._id;
              }

              // Find broker by phone
              let broker = null;
              if (cleanedRow.brokerPhone) {
                const user = await User.findOne({ phone: cleanedRow.brokerPhone, role: 'broker' });
                if (user) {
                  broker = await BrokerDetail.findOne({ userId: user._id });
                }
              }

              if (!broker) {
                failedRows.push({
                  row: row.rowNumber,
                  data: row,
                  error: 'Broker not found with provided phone number'
                });
                continue;
              }

              // Create Lead
              const lead = await Lead.create({
                customerName: cleanedRow.customerName,
                customerPhone: cleanedRow.customerPhone,
                customerEmail: cleanedRow.customerEmail,
                requirement: cleanedRow.requirement,
                propertyType: cleanedRow.propertyType,
                budget: cleanedRow.budget ? parseFloat(cleanedRow.budget) : undefined,
                primaryRegion: primaryRegionId,
                secondaryRegion: secondaryRegionId,
                createdBy: broker._id,
                status: cleanedRow.status || 'New',
                verificationStatus: 'Verified',
                notes: cleanedRow.notes
              });

              importedLeads.push({
                row: row.rowNumber,
                leadId: lead._id,
                customerName: cleanedRow.customerName,
                customerPhone: cleanedRow.customerPhone
              });

            } catch (error) {
              console.error(`Error processing row ${row.rowNumber}:`, error);
              failedRows.push({
                row: row.rowNumber,
                data: row,
                error: error.message
              });
            }
          }

          return successResponse(res, {
            message: 'CSV import completed',
            summary: {
              totalRows: results.length,
              successfulImports: importedLeads.length,
              failedImports: failedRows.length
            },
            importedLeads,
            failedRows
          }, 200);

        } catch (error) {
          console.error('Error processing CSV:', error);
          return errorResponse(res, 'Error processing CSV file', 500);
        }
      })
      .on('error', (error) => {
        console.error('Error reading CSV:', error);
        return errorResponse(res, 'Error reading CSV file', 500);
      });

  } catch (error) {
    console.error('Import error:', error);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Clean property row data
 */
const cleanPropertyRowData = (row) => {
  const fieldMapping = {
    'title': 'title',
    'description': 'description',
    'short description': 'description',
    'shortdescription': 'description',
    'property description': 'propertyDescription',
    'propertydescription': 'propertyDescription',
    'detailed description': 'propertyDescription',
    'detaileddescription': 'propertyDescription',
    'property type': 'propertyType',
    'propertytype': 'propertyType',
    'sub type': 'subType',
    'subtype': 'subType',
    'price': 'price',
    'price unit': 'priceUnit',
    'priceunit': 'priceUnit',
    'property size': 'propertySize',
    'propertysize': 'propertySize',
    'size': 'propertySize',
    'address': 'address',
    'city': 'city',
    'region': 'region',
    'is hot property': 'isHotProperty',
    'hot property': 'isHotProperty',
    'hotproperty': 'isHotProperty',
    'bedrooms': 'bedrooms',
    'bathrooms': 'bathrooms',
    'furnishing': 'furnishing',
    'amenities': 'amenities',
    'property amenities': 'amenities',
    'propertyamenities': 'amenities',
    'nearby amenities': 'nearbyAmenities',
    'nearbyamenities': 'nearbyAmenities',
    'features': 'features',
    'location benefits': 'locationBenefits',
    'locationbenefits': 'locationBenefits',
    'images': 'images',
    'image': 'images',
    'videos': 'videos',
    'video': 'videos',
    'notes': 'notes',
    'note': 'notes',
    'broker phone': 'brokerPhone',
    'brokerphone': 'brokerPhone',
    'facing direction': 'facingDirection',
    'facingdirection': 'facingDirection',
    'possession status': 'possessionStatus',
    'possessionstatus': 'possessionStatus',
    'property age years': 'propertyAgeYears',
    'propertyageyears': 'propertyAgeYears',
    'property age': 'propertyAgeYears',
    'propertyage': 'propertyAgeYears',
    'age': 'propertyAgeYears'
  };

  const cleaned = {};
  
  for (const [key, value] of Object.entries(row)) {
    if (key === 'rowNumber') {
      cleaned.rowNumber = value;
      continue;
    }
    
    const normalizedKey = key.toLowerCase().trim();
    const mappedKey = fieldMapping[normalizedKey] || key;
    
    const cleanedValue = typeof value === 'string' ? value.trim() : value;
    cleaned[mappedKey] = cleanedValue === '' ? undefined : cleanedValue;
  }

  return cleaned;
};

/**
 * Clean lead row data
 */
const cleanLeadRowData = (row) => {
  const fieldMapping = {
    'customer name': 'customerName',
    'customername': 'customerName',
    'name': 'customerName',
    'customer phone': 'customerPhone',
    'customerphone': 'customerPhone',
    'phone': 'customerPhone',
    'customer email': 'customerEmail',
    'customeremail': 'customerEmail',
    'email': 'customerEmail',
    'requirement': 'requirement',
    'property type': 'propertyType',
    'propertytype': 'propertyType',
    'budget': 'budget',
    'primary region': 'primaryRegion',
    'primaryregion': 'primaryRegion',
    'region': 'primaryRegion',
    'secondary region': 'secondaryRegion',
    'secondaryregion': 'secondaryRegion',
    'broker phone': 'brokerPhone',
    'brokerphone': 'brokerPhone',
    'assigned to': 'brokerPhone',
    'status': 'status',
    'notes': 'notes'
  };

  const cleaned = {};
  
  for (const [key, value] of Object.entries(row)) {
    if (key === 'rowNumber') {
      cleaned.rowNumber = value;
      continue;
    }
    
    const normalizedKey = key.toLowerCase().trim();
    const mappedKey = fieldMapping[normalizedKey] || key;
    
    const cleanedValue = typeof value === 'string' ? value.trim() : value;
    cleaned[mappedKey] = cleanedValue === '' ? undefined : cleanedValue;
  }

  return cleaned;
};


export default {
  importBrokersFromCSV,
  importPropertiesFromCSV,
  importLeadsFromCSV
};

