import User from "../models/User.js";
import BrokerDetail from '../models/BrokerDetail.js';
import mongoose from "mongoose";

const getUserIdFromBrokerId = async (brokerId) => {
  if (!mongoose.Types.ObjectId.isValid(brokerId)) {
    throw new Error('Invalid brokerId');
  }

  const broker = await BrokerDetail
    .findById(brokerId)
    .select('userId')
    .lean();

  if (!broker) {
    throw new Error('Broker not found');
  }

  return broker.userId;
};


export const getBotStatus = async (brokerId) => {
  const userId = await getUserIdFromBrokerId(brokerId)
  const user = await User.findById(userId);
  // Broker not found
  if (!user) {
    return {
      isBotEnable: false,
      botResponseTime: 0
    };
  }
  return {
    isBotEnable: user.isBotEnable ?? false,
    botResponseTime: user.botResponseTime ?? 0
  };
};