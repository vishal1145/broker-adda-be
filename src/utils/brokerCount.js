import Region from '../models/Region.js';
import BrokerDetail from '../models/BrokerDetail.js';

// Update broker count for a specific region
export const updateRegionBrokerCount = async (regionId) => {
  try {
    const brokerCount = await BrokerDetail.countDocuments({
      region: regionId,
      status: 'active'
    });
    
    await Region.findByIdAndUpdate(regionId, { brokerCount });
    return brokerCount;
  } catch (error) {
    console.error('Error updating broker count for region:', regionId, error);
    throw error;
  }
};

// Update broker counts for multiple regions
export const updateMultipleRegionBrokerCounts = async (regionIds) => {
  try {
    const updatePromises = regionIds.map(async (regionId) => {
      const brokerCount = await BrokerDetail.countDocuments({
        region: regionId,
        status: 'active'
      });
      
      return Region.findByIdAndUpdate(regionId, { brokerCount });
    });
    
    await Promise.all(updatePromises);
  } catch (error) {
    console.error('Error updating broker counts for regions:', regionIds, error);
    throw error;
  }
};

// Update all region broker counts
export const updateAllRegionBrokerCounts = async () => {
  try {
    const regions = await Region.find({}, '_id');
    const regionIds = regions.map(region => region._id);
    
    await updateMultipleRegionBrokerCounts(regionIds);
    console.log('Updated broker counts for all regions');
  } catch (error) {
    console.error('Error updating all region broker counts:', error);
    throw error;
  }
};
