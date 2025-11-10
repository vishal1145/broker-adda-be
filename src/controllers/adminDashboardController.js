import BrokerDetail from '../models/BrokerDetail.js';
import Lead from '../models/Lead.js';
import Property from '../models/Property.js';
import { successResponse, errorResponse } from '../utils/response.js';


export const getAdminDashboardStats = async (req, res) => {
  try {
    const { period = 'month', startDate, endDate, date } = req.query;

    // Validate period
    if (!['day', 'month', 'week'].includes(period)) {
      return errorResponse(res, 'Period must be either "day", "month", or "week"', 400);
    }

    // Parse date range if provided
    let dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) {
        dateFilter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        dateFilter.createdAt.$lte = new Date(endDate);
      }
    }

    // Day names mapping (MongoDB dayOfWeek: 1=Sunday, 2=Monday, ..., 7=Saturday)
    // We'll convert to: 1=Monday, 2=Tuesday, ..., 7=Sunday
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayOrder = [2, 3, 4, 5, 6, 7, 1]; // MongoDB day order mapped to Mon-Sun

    // Month names mapping
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                        'July', 'August', 'September', 'October', 'November', 'December'];

    // Helper function to format date for grouping
    const getDateGroupFormat = (period) => {
      if (period === 'day') {
        return {
          dayOfWeek: { $dayOfWeek: '$createdAt' }
        };
      } else if (period === 'week') {
        // For week period, group by day of week (current week only)
        return {
          dayOfWeek: { $dayOfWeek: '$createdAt' }
        };
      } else {
        return {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        };
      }
    };

    // Helper function to format group key
    const formatGroupKey = (group, period) => {
      if (period === 'day') {
        // Convert MongoDB dayOfWeek (1=Sun, 7=Sat) to our order (1=Mon, 7=Sun)
        const dayIndex = dayOrder.indexOf(group.dayOfWeek);
        return dayNames[dayIndex] || `Day${group.dayOfWeek}`;
      } else if (period === 'week') {
        // For week period, return day name (Sunday to Saturday)
        // MongoDB dayOfWeek: 1=Sunday, 2=Monday, ..., 7=Saturday
        const dayIndex = group.dayOfWeek === 1 ? 6 : group.dayOfWeek - 2; // Convert to Sun-Sat order
        return dayNames[dayIndex] || `Day${group.dayOfWeek}`;
      } else {
        return `${group.year}-${monthNames[group.month - 1]}`;
      }
    };

    // Get total counts
    const [totalBrokers, totalLeads, totalProperties] = await Promise.all([
      BrokerDetail.countDocuments(),
      Lead.countDocuments(),
      Property.countDocuments()
    ]);

    // Build sort object based on period
    let sortObj;
    if (period === 'day') {
      sortObj = { '_id.dayOfWeek': 1 };
    } else if (period === 'week') {
      sortObj = { '_id.dayOfWeek': 1 }; // Sort by day of week (Sunday=1 to Saturday=7)
    } else {
      sortObj = { '_id.year': 1, '_id.month': 1 };
    }

    // For week period, filter to specified week (or current week if no date provided)
    let weekDateFilter = {};
    let weekStartDate = null;
    let weekEndDate = null;
    
    if (period === 'week') {
      // Use provided date or current date
      const targetDate = date ? new Date(date) : new Date();
      
      if (date && isNaN(targetDate.getTime())) {
        return errorResponse(res, 'Invalid date format. Use YYYY-MM-DD format', 400);
      }
      
      const targetDay = targetDate.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
      
      // Calculate Sunday of the week containing the target date
      const sunday = new Date(targetDate);
      sunday.setDate(targetDate.getDate() - targetDay);
      sunday.setHours(0, 0, 0, 0);
      
      // Calculate Saturday of that week
      const saturday = new Date(sunday);
      saturday.setDate(sunday.getDate() + 6);
      saturday.setHours(23, 59, 59, 999);
      
      // Store week dates for response
      weekStartDate = sunday;
      weekEndDate = saturday;
      
      // Set week filter
      weekDateFilter.createdAt = {
        $gte: sunday,
        $lte: saturday
      };
    } else {
      // For other periods, use the original date filter
      weekDateFilter = dateFilter;
    }

    // Get brokers by period
    let brokersByPeriod, leadsByPeriod, propertiesByPeriod;
    
    if (period === 'week') {
      // For week period, aggregate by day of week for current week only
      brokersByPeriod = await BrokerDetail.aggregate([
        { $match: weekDateFilter },
        {
          $group: {
            _id: getDateGroupFormat(period),
            count: { $sum: 1 }
          }
        },
        { $sort: sortObj }
      ]);
      
      leadsByPeriod = await Lead.aggregate([
        { $match: weekDateFilter },
        {
          $group: {
            _id: getDateGroupFormat(period),
            count: { $sum: 1 }
          }
        },
        { $sort: sortObj }
      ]);
      
      propertiesByPeriod = await Property.aggregate([
        { $match: weekDateFilter },
        {
          $group: {
            _id: getDateGroupFormat(period),
            count: { $sum: 1 }
          }
        },
        { $sort: sortObj }
      ]);
    } else {
      // For day and month periods, use standard aggregation
      brokersByPeriod = await BrokerDetail.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: getDateGroupFormat(period),
            count: { $sum: 1 }
          }
        },
        { $sort: sortObj }
      ]);

      leadsByPeriod = await Lead.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: getDateGroupFormat(period),
            count: { $sum: 1 }
          }
        },
        { $sort: sortObj }
      ]);

      propertiesByPeriod = await Property.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: getDateGroupFormat(period),
            count: { $sum: 1 }
          }
        },
        { $sort: sortObj }
      ]);
    }

    // Helper function to ensure all days/months are included
    const ensureCompletePeriodData = (data, period) => {
      if (period === 'day') {
        // Ensure all 7 days are present (Monday to Sunday)
        const dayMap = new Map();
        data.forEach(item => {
          const dayIndex = dayOrder.indexOf(item._id.dayOfWeek);
          dayMap.set(dayIndex, {
            period: dayNames[dayIndex],
            dayName: dayNames[dayIndex],
            dayOfWeek: dayIndex + 1,
            count: item.count
          });
        });
        
        // Fill in missing days with 0 count
        return dayNames.map((dayName, index) => {
          if (dayMap.has(index)) {
            return dayMap.get(index);
          }
          return {
            period: dayName,
            dayName: dayName,
            dayOfWeek: index + 1,
            count: 0
          };
        });
      } else if (period === 'month') {
        // Group by year-month combination and ensure all months for each year
        const yearMonthMap = new Map();
        const years = new Set();
        
        data.forEach(item => {
          const year = item._id.year;
          const month = item._id.month;
          years.add(year);
          const key = `${year}-${month}`;
          yearMonthMap.set(key, {
            period: `${year}-${monthNames[month - 1]}`,
            monthName: monthNames[month - 1],
            month: month,
            year: year,
            count: item.count
          });
        });
        
        // For each year, ensure all 12 months are present
        const result = [];
        const sortedYears = Array.from(years).sort();
        
        // If no data, use current year
        if (sortedYears.length === 0) {
          const currentYear = new Date().getFullYear();
          sortedYears.push(currentYear);
        }
        
        sortedYears.forEach(year => {
          monthNames.forEach((monthName, index) => {
            const month = index + 1;
            const key = `${year}-${month}`;
            if (yearMonthMap.has(key)) {
              result.push(yearMonthMap.get(key));
            } else {
              result.push({
                period: `${year}-${monthName}`,
                monthName: monthName,
                month: month,
                year: year,
                count: 0
              });
            }
          });
        });
        
        return result;
      } else {
        // Week period - ensure all 7 days (Sunday to Saturday) are present for current week
        // MongoDB dayOfWeek: 1=Sunday, 2=Monday, ..., 7=Saturday
        // We want: Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday
        const weekDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayMap = new Map();
        
        data.forEach(item => {
          // MongoDB dayOfWeek: 1=Sunday, 2=Monday, ..., 7=Saturday
          const dayOfWeek = item._id.dayOfWeek;
          const dayIndex = dayOfWeek - 1; // Convert to 0-6 index
          dayMap.set(dayIndex, {
            period: weekDayNames[dayIndex],
            dayName: weekDayNames[dayIndex],
            dayOfWeek: dayOfWeek,
            count: item.count
          });
        });
        
        // Fill in missing days with 0 count (Sunday to Saturday)
        return weekDayNames.map((dayName, index) => {
          if (dayMap.has(index)) {
            return dayMap.get(index);
          }
          return {
            period: dayName,
            dayName: dayName,
            dayOfWeek: index + 1, // MongoDB format: 1=Sunday, 7=Saturday
            count: 0
          };
        });
      }
    };

    // Format the period data
    const formatPeriodData = (data) => {
      return ensureCompletePeriodData(data, period);
    };

    // Get additional statistics
    const [
      activeBrokers,
      blockedBrokers,
      activeProperties,
      pendingProperties,
      newLeads,
      closedLeads
    ] = await Promise.all([
      BrokerDetail.countDocuments({ approvedByAdmin: 'unblocked', status: 'active' }),
      BrokerDetail.countDocuments({ approvedByAdmin: 'blocked' }),
      Property.countDocuments({ status: 'Active' }),
      Property.countDocuments({ status: 'Pending Approval' }),
      Lead.countDocuments({ status: 'New' }),
      Lead.countDocuments({ status: 'Closed' })
    ]);

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [
      recentBrokers,
      recentLeads,
      recentProperties
    ] = await Promise.all([
      BrokerDetail.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      Lead.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      Property.countDocuments({ createdAt: { $gte: sevenDaysAgo } })
    ]);

    // Prepare response data
    const responseData = {
      totals: {
        brokers: totalBrokers,
        leads: totalLeads,
        properties: totalProperties
      },
      statusBreakdown: {
        brokers: {
          active: activeBrokers,
          blocked: blockedBrokers
        },
        properties: {
          active: activeProperties,
          pending: pendingProperties
        },
        leads: {
          new: newLeads,
          closed: closedLeads
        }
      },
      recentActivity: {
        last7Days: {
          brokers: recentBrokers,
          leads: recentLeads,
          properties: recentProperties
        }
      },
      byPeriod: {
        period: period,
        brokers: formatPeriodData(brokersByPeriod),
        leads: formatPeriodData(leadsByPeriod),
        properties: formatPeriodData(propertiesByPeriod)
      }
    };

    // Add week date range if period is 'week'
    if (period === 'week' && weekStartDate && weekEndDate) {
      responseData.byPeriod.weekRange = {
        startDate: weekStartDate.toISOString().split('T')[0],
        endDate: weekEndDate.toISOString().split('T')[0],
        startDateFormatted: weekStartDate.toLocaleDateString(),
        endDateFormatted: weekEndDate.toLocaleDateString(),
        selectedDate: date || null
      };
    }

    return successResponse(res, 'Admin dashboard statistics retrieved successfully', responseData);
  } catch (error) {
    console.error('getAdminDashboardStats error:', error);
    return errorResponse(res, 'Failed to retrieve dashboard statistics', 500, error.message);
  }
};

