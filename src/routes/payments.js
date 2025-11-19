import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import Payment from '../models/Payment.js';
import dotenv from 'dotenv';
import { authenticate } from '../middleware/auth.js';
import moment from 'moment';
import Subscription from '../models/Subscription.js';
dotenv.config();

const router = express.Router();
const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const RZP_BASE = 'https://api.razorpay.com/v1';

// POST /api/payments/create-order
// body: { amount: Number (in paise), currency?: 'INR', receipt?: string }
router.post('/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt, planType, period } = req.body;
    if (!amount || isNaN(amount)) return res.status(400).json({ success:false, error: 'amount (in paise) required' });

    const payload = { amount: Number(amount), currency, receipt: receipt || `rcpt_${Date.now()}`, payment_capture: 1 };
    const resp = await axios.post(`${RZP_BASE}/orders`, payload, {
      auth: { username: KEY_ID, password: KEY_SECRET },
      headers: { 'Content-Type': 'application/json' }
    });

    return res.json({ success: true, order: resp.data, planType, period });
  } catch (err) {
    console.error('create-order error', err?.response?.data || err.message);
    return res.status(500).json({ success:false, error: 'Could not create order' });
  }
});

// POST /api/payments/verify-payment
// body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId? }
router.post('/verify-payment', authenticate, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planType, period } = req.body;
    console.log("planType : ", planType)
    console.log("period : ", period)
    const userId = req.user._id;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success:false, error: 'Missing fields' });
    }

    const generated = crypto.createHmac('sha256', KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generated !== razorpay_signature) {
      return res.status(400).json({ success:false, error: 'Invalid signature' });
    }

    // Idempotency check
    const existing = await Payment.findOne({ razorpayPaymentId: razorpay_payment_id });
    if (existing) {
      return res.json({ success: true, message: 'Already recorded', payment: existing });
    }

    // Optional: fetch payment details from Razorpay for additional info
    let paymentDetails = null;
    try {
      const detailsResp = await axios.get(`${RZP_BASE}/payments/${razorpay_payment_id}`, {
        auth: { username: KEY_ID, password: KEY_SECRET }
      });
      paymentDetails = detailsResp.data;
    } catch (e) {
      // Not fatal; we will still save minimal info
      console.warn('Could not fetch payment details', e?.response?.data || e.message);
    }

    const payDoc = {
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      amount: (paymentDetails?.amount / 100 ?? null) || null,
      currency: (paymentDetails?.currency ?? 'INR'),
      status: paymentDetails?.status ?? 'captured',
      user: userId
    };

    const saved = await Payment.create(payDoc);
    console.log("planType : ", planType)
    console.log("periodUnit : ", period)
    await activateSubscription({ userId, planType, paymentDoc: saved, periodValue: 1, periodUnit: period, autoRenew: false });

    return res.json({ success: true, message: 'Payment verified and saved', payment: saved });
  } catch (err) {
    console.error('verify-payment error', err);
    return res.status(500).json({ success:false, error: 'Verification failed' });
  }
});

export async function activateSubscription({ userId, planType, paymentDoc, periodValue, periodUnit, autoRenew = false }) {
    const amount = paymentDoc.amount || 0;
    const now = new Date();
    const existing = await Subscription.findOne({ user: userId, status: 'active' }).sort({ endDate: -1 });
  
    let startDate;
    if (existing && existing.endDate && existing.endDate > now) {
      startDate = existing.endDate;
    } else {
      startDate = now;
    }
  
    const endDate = moment(startDate).add(periodValue, periodUnit).toDate();

    const sub = await Subscription.create({
      user: userId,
      planType,
      amount,
      currency: 'INR',
      periodValue,
      periodUnit,
      startDate,
      endDate,
      status: 'active',
      paymentRef: paymentDoc._id || null,
      autoRenew
    });
  
    return sub;
  }

//   const isActive = await Subscription.exists({
//     user: userId,
//     status: 'active',
//     endDate: { $gt: new Date() }
//   });

export default router;
