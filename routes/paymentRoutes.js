const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const mongoose = require('mongoose');
const verifyToken = require('../middleware/auth');
const User = require('../models/User');
const Order = require('../models/Order'); // 👈 Order मॉडल इम्पोर्ट किया

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// 1. कार्ट टोटल का ऑर्डर बनाएँ
router.post('/create-order', verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;

    const numericAmount = Math.round(Number(amount) * 100); // ₹ to paise
    if (!numericAmount || numericAmount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid order amount" });
    }

    const options = {
      amount: numericAmount,
      currency: "INR",
      receipt: `cart_${Date.now()}`
    };

    const order = await razorpay.orders.create(options);

    return res.status(200).json({ 
      success: true, 
      order,
      keyId: process.env.RAZORPAY_KEY_ID 
    });
  } catch (err) {
    console.error("Razorpay Order Creation Failed:", err?.error || err.message);
    return res.status(500).json({ 
      success: false, 
      message: err?.error?.description || "Order creation failed" 
    });
  }
});

// 2. पेमेंट वेरिफाई करें, कार्ट खाली करें, एसेट्स अनलॉक करें और ORDER रिकॉर्ड सेव करें
router.post('/verify-payment', verifyToken, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, cartItems } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: "Missing payment verification parameters" });
    }

    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest("hex");

    if (razorpay_signature === expectedSign) {
      const userId = req.user?.id || req.user?._id;

      if (!userId) {
        return res.status(401).json({ success: false, message: "User authentication failed" });
      }

      // 🎯 1. Photo IDs को साफ़-सुथरे ObjectId फॉर्मेट में तैयार करें
      const rawIds = (cartItems || []).map(item => {
        if (item?.photo?._id) return item.photo._id;
        if (item?.photo) return item.photo;
        return item?._id;
      }).filter(Boolean);

      const validObjectIds = rawIds
        .filter(id => mongoose.Types.ObjectId.isValid(id))
        .map(id => new mongoose.Types.ObjectId(id));

      // 🎯 2. Order Schema के लिए Items Array और Total Amount बनाएँ
      const orderItems = (cartItems || []).map(item => {
        const pId = item?.photo?._id || item?.photo || item?._id;
        const rawPrice = item?.price || item?.photo?.price || 0;
        const numPrice = parseFloat(String(rawPrice).replace(/[^0-9.]/g, '')) || 0;

        return {
          photoId: mongoose.Types.ObjectId.isValid(pId) ? new mongoose.Types.ObjectId(pId) : pId,
          price: numPrice
        };
      });

      const calculatedTotal = orderItems.reduce((acc, curr) => acc + curr.price, 0);

      // 🚀 3. DATABASE UPDATE: नया Order डॉक्यूमेंट बनाएँ (Dashboard & Revenue Sync के लिए)
      await Order.create({
        user: userId,
        items: orderItems,
        photos: validObjectIds,
        totalAmount: calculatedTotal,
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        paymentStatus: 'completed'
      });

      // 🚀 4. DATABASE UPDATE: यूज़र की कार्ट खाली करें और खरीदे गए एसेट्स अनलॉक करें
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          $set: { cart: [] },$addToSet: { 
            purchased: { $each: validObjectIds },
            purchasedPhotos: { $each: validObjectIds } 
          }
        },
        { new: true }
      );

      console.log(`[Order & Payment Success] User: ${userId} - Total: ₹${calculatedTotal}`);

      return res.status(200).json({ 
        success: true, 
        message: "Payment verified successfully, order recorded, and assets unlocked!",
        purchasedCount: updatedUser?.purchasedPhotos?.length || 0
      });
    }

    return res.status(400).json({ success: false, message: "Invalid payment signature" });
  } catch (err) {
    console.error("Payment Verification Error:", err.message);
    return res.status(500).json({ success: false, message: "Internal server verification error" });
  }
});

module.exports = router;